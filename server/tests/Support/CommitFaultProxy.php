<?php
declare(strict_types=1);

/*
 * TEST-ONLY — AWP-01 B1, option B-ii (Owner GO 2026-11-18: G-1, G-2, G-4).
 *
 * A COMMIT-boundary fault proxy for the ADR-016 B1 case: the test's own Database connects through a loopback
 * relay of the MariaDB client/server protocol; production code has no seam at all. The relay forwards every
 * supported packet unchanged. When armed, it fails exactly one COMMIT — the one that ends a transaction whose
 * last five prepared executions are the expected pay statements (§5 steps 4–7), each acknowledged by the server
 * with an OK packet, one affected row and the in-transaction status flag, with nothing but COM_STMT_CLOSE between
 * the last acknowledgment and the COMMIT. That COMMIT is never forwarded: the proxy observes the open
 * transaction over its own direct connection, answers the client with an ERR packet, then requires the client's
 * ROLLBACK to be forwarded and acknowledged by the server with the in-transaction flag cleared.
 *
 * Supported, and only this: protocol 41, no TLS, no compression, no query attributes, no multi-statements, no
 * MariaDB extended capabilities, single-packet payloads, strictly request/response command flow, and the
 * commands QUIT, INIT_DB, QUERY, PING, STMT_PREPARE, STMT_EXECUTE, STMT_CLOSE, STMT_RESET and SET_OPTION.
 * Anything else is refused and the session is aborted (fail closed). This is not a general database proxy and
 * claims no protocol compatibility beyond that list.
 *
 * Classes: MysqlPacket (framing and packet parsing), CommitFaultRelay (the pure state machine; no I/O),
 * CommitFaultEvidence (an independent re-check of a result, so a test never trusts the relay's own verdict),
 * CommitFaultEvidenceStore (retains the original result.json bytes outside the temporary directory, SHA-256
 * verified), CommitFaultTrxPoller (the bounded after-rollback INNODB_TRX poll) and CommitFaultProxyProcess (the
 * launcher for tests/Support/commit-fault-proxy.php).
 * Documentation: AWP-01-B1-BII-IMPLEMENTATION package, PROXY-PROTOCOL-AND-FAILURE-MODES.md.
 */

namespace TamOs\Tests\Support;

/** The relay met something it does not explicitly support, or evidence it cannot accept: the session is aborted. */
final class RelayRefusal extends \RuntimeException
{
}

final class MysqlPacket
{
    /** A payload of 0xFFFFFF bytes announces a multi-packet payload, which is not supported. */
    public const MULTI_PACKET = 0xFFFFFF;
    public const STATUS_IN_TRANS = 0x0001;

    /**
     * Takes every complete packet off the front of $buffer.
     *
     * @return list<array{0: int, 1: string}> [sequence id, payload]
     */
    public static function take(string &$buffer): array
    {
        $out = [];
        while (strlen($buffer) >= 4) {
            $length = ord($buffer[0]) | (ord($buffer[1]) << 8) | (ord($buffer[2]) << 16);
            if ($length === self::MULTI_PACKET) {
                throw new RelayRefusal('multi-packet payloads are not supported');
            }
            if (strlen($buffer) < 4 + $length) {
                break;
            }
            $out[] = [ord($buffer[3]), substr($buffer, 4, $length)];
            $buffer = substr($buffer, 4 + $length);
        }
        return $out;
    }

    public static function frame(int $seq, string $payload): string
    {
        $n = strlen($payload);
        if ($n >= self::MULTI_PACKET) {
            throw new \LogicException('payload too large for one packet');
        }
        return chr($n & 0xFF) . chr(($n >> 8) & 0xFF) . chr(($n >> 16) & 0xFF) . chr($seq & 0xFF) . $payload;
    }

    /** A length-encoded integer at $at (advanced past it). */
    public static function lenenc(string $p, int &$at): int
    {
        if ($at >= strlen($p)) {
            throw new RelayRefusal('truncated length-encoded integer');
        }
        $first = ord($p[$at]);
        $size = match (true) {
            $first < 0xFB => 0,
            $first === 0xFC => 2,
            $first === 0xFD => 3,
            $first === 0xFE => 8,
            default => throw new RelayRefusal('invalid length-encoded integer'),
        };
        if ($at + 1 + $size > strlen($p)) {
            throw new RelayRefusal('truncated length-encoded integer');
        }
        if ($size === 0) {
            $at++;
            return $first;
        }
        $value = 0;
        for ($i = 0; $i < $size; $i++) {
            $value |= ord($p[$at + 1 + $i]) << (8 * $i);
        }
        $at += 1 + $size;
        return $value;
    }

    /** @return array{affectedRows: int, status: int}|null the OK packet's fields (protocol 41), or null when $p is not an OK packet */
    public static function ok(string $p): ?array
    {
        if ($p === '' || $p[0] !== "\x00" || strlen($p) < 7) {
            return null;
        }
        $at = 1;
        $affected = self::lenenc($p, $at);
        self::lenenc($p, $at);                                  // last insert id
        if ($at + 4 > strlen($p)) {
            throw new RelayRefusal('truncated OK packet');
        }
        return ['affectedRows' => $affected, 'status' => ord($p[$at]) | (ord($p[$at + 1]) << 8)];
    }

    /** @return array{code: int, sqlstate: string}|null */
    public static function err(string $p): ?array
    {
        if ($p === '' || $p[0] !== "\xFF" || strlen($p) < 3) {
            return null;
        }
        $code = ord($p[1]) | (ord($p[2]) << 8);
        $sqlstate = strlen($p) >= 9 && $p[3] === '#' ? substr($p, 4, 5) : '';
        return ['code' => $code, 'sqlstate' => $sqlstate];
    }

    public static function errPayload(int $code, string $sqlstate, string $message): string
    {
        return "\xFF" . chr($code & 0xFF) . chr(($code >> 8) & 0xFF) . '#' . $sqlstate . $message;
    }
}

final class CommitFaultRelay
{
    public const INJECTED_CODE = 1644;                          // ER_SIGNAL_EXCEPTION
    public const INJECTED_SQLSTATE = '45000';
    public const INJECTED_MESSAGE = 'B1 injected before COMMIT';
    public const REFUSED_CODE = 1105;                           // ER_UNKNOWN_ERROR
    public const REFUSED_SQLSTATE = 'HY000';

    private const CLIENT_COMPRESS = 0x00000020;
    private const CLIENT_PROTOCOL_41 = 0x00000200;
    private const CLIENT_SSL = 0x00000800;
    private const CLIENT_MULTI_STATEMENTS = 0x00010000;
    private const CLIENT_ZSTD_COMPRESSION = 0x04000000;
    private const CLIENT_QUERY_ATTRIBUTES = 0x08000000;
    private const CLIENT_MYSQL = 0x00000001;

    private const COMMANDS = [0x01 => 'quit', 0x02 => 'init-db', 0x03 => 'query', 0x0E => 'ping', 0x16 => 'prepare',
        0x17 => 'execute', 0x19 => 'close', 0x1A => 'reset', 0x1B => 'set-option'];
    /** Transaction-control words anywhere other than the three exact forms are ambiguous and refused. */
    private const TX_CONTROL = '/\b(COMMIT|ROLLBACK|BEGIN|START\s+TRANSACTION|SAVEPOINT|RELEASE|XA|AUTOCOMMIT|CHAIN)\b/i';

    private string $phase = 'greeting';                         // greeting → auth → command → closed
    private string $fromClient = '';
    private string $fromServer = '';
    private string $toClient = '';
    private string $toServer = '';
    private int $handshakeSeq = -1;
    private ?int $threadId = null;
    /** @var ?array{command: string, sql?: string, stmt?: int} */
    private ?array $awaiting = null;
    private bool $commandSeen = false;
    private int $serverSeq = 0;
    /** @var array<int, string> statement id => prepared SQL */
    private array $statements = [];
    private ?int $txn = null;
    private int $txnCount = 0;
    private string $intercept = 'none';                         // none → pending → sent → rolled-back
    private ?string $failure = null;
    private bool $postObservationDue = false;
    /** @var list<array<string, mixed>> */
    private array $events = [];

    /** @param list<string> $expected the five wire SQL texts of §5 steps 4–7, in order (armed only) */
    public function __construct(private readonly bool $armed, private readonly array $expected = [])
    {
        if ($armed && count($expected) !== 5) {
            throw new \LogicException('an armed relay needs the five expected statements');
        }
    }

    public function client(string $bytes): void
    {
        $this->guarded(function () use ($bytes): void {
            $this->fromClient .= $bytes;
            foreach (MysqlPacket::take($this->fromClient) as [$seq, $payload]) {
                $this->clientPacket($seq, $payload);
            }
        });
    }

    public function server(string $bytes): void
    {
        $this->guarded(function () use ($bytes): void {
            $this->fromServer .= $bytes;
            foreach (MysqlPacket::take($this->fromServer) as [$seq, $payload]) {
                $this->serverPacket($seq, $payload);
            }
        });
    }

    public function drainToClient(): string
    {
        [$out, $this->toClient] = [$this->toClient, ''];
        return $out;
    }

    public function drainToServer(): string
    {
        [$out, $this->toServer] = [$this->toServer, ''];
        return $out;
    }

    public function failure(): ?string
    {
        return $this->failure;
    }

    public function threadId(): ?int
    {
        return $this->threadId;
    }

    /** The intercepted COMMIT waits for the observer: the ERR is sent only after observe() records what it saw. */
    public function needsObservation(): bool
    {
        return $this->intercept === 'pending' && $this->failure === null;
    }

    /** @param array<string, mixed> $observation */
    public function observe(array $observation): void
    {
        if ($this->intercept !== 'pending') {
            throw new \LogicException('no intercepted COMMIT is waiting');
        }
        $this->event('observation', ['phase' => 'intercept', 'data' => $observation]);
        $this->toClient .= MysqlPacket::frame(1, MysqlPacket::errPayload(self::INJECTED_CODE, self::INJECTED_SQLSTATE, self::INJECTED_MESSAGE));
        $this->event('err-sent', ['code' => self::INJECTED_CODE, 'sqlstate' => self::INJECTED_SQLSTATE]);
        $this->intercept = 'sent';
    }

    public function needsPostObservation(): bool
    {
        return $this->postObservationDue;
    }

    /** @param array<string, mixed> $observation */
    public function observeAfterRollback(array $observation): void
    {
        $this->postObservationDue = false;
        $this->event('observation', ['phase' => 'after-rollback', 'data' => $observation]);
    }

    public function clientClosed(): void
    {
        $this->event('client-closed', []);
        $this->phase = 'closed';
    }

    public function serverClosed(): void
    {
        $this->event('server-closed', []);
        $this->phase = 'closed';
    }

    /** Records a failure the process layer detected (a second client, a timeout, an upstream error). */
    public function abort(string $reason): void
    {
        if ($this->failure === null) {
            $this->failure = $reason;
            $this->event('refusal', ['reason' => $reason]);
        }
    }

    /** @return array<string, mixed> */
    public function result(): array
    {
        $counts = array_count_values(array_column($this->events, 'type'));
        $verdict = match (true) {
            $this->failure !== null => 'failed',
            !$this->armed => 'transparent',
            $this->intercept === 'rolled-back' && ($counts['commit-intercepted'] ?? 0) === 1 && ($counts['commit-forwarded'] ?? 0) === 0 => 'intercepted-rolled-back',
            default => 'incomplete',
        };
        return ['armed' => $this->armed, 'verdict' => $verdict, 'failure' => $this->failure, 'threadId' => $this->threadId,
            'expected' => $this->expected, 'events' => $this->events];
    }

    private function guarded(\Closure $fn): void
    {
        if ($this->failure !== null) {
            return;                                             // after a refusal nothing more is relayed
        }
        try {
            $fn();
        } catch (RelayRefusal $e) {
            $this->abort($e->getMessage());
            if ($this->phase === 'command') {
                $this->toClient .= MysqlPacket::frame(1, MysqlPacket::errPayload(self::REFUSED_CODE, self::REFUSED_SQLSTATE, 'B1 proxy refused: ' . $e->getMessage()));
            }
            $this->phase = 'closed';
        }
    }

    private function clientPacket(int $seq, string $payload): void
    {
        if ($this->phase === 'greeting' || $this->phase === 'closed') {
            throw new RelayRefusal('a client packet in the ' . $this->phase . ' phase');
        }
        if ($this->phase === 'auth') {
            $this->handshakePacket('client', $seq, $payload);
            $this->toServer .= MysqlPacket::frame($seq, $payload);
            return;
        }
        if ($seq !== 0) {
            throw new RelayRefusal('a client packet that is not a new command (sequence ' . $seq . ')');
        }
        if ($payload === '') {
            throw new RelayRefusal('an empty command packet');
        }
        $command = self::COMMANDS[ord($payload[0])] ?? null;
        if ($command === null) {
            throw new RelayRefusal(sprintf('unsupported command 0x%02x', ord($payload[0])));
        }
        if ($this->awaiting !== null) {
            throw new RelayRefusal('a pipelined command before the previous response');
        }
        if ($this->intercept === 'sent' && !in_array($command, ['close', 'query', 'quit'], true)) {
            throw new RelayRefusal('an unexpected ' . $command . ' after the intercepted COMMIT');
        }
        $this->commandSeen = true;
        $this->serverSeq = 0;
        match ($command) {
            'query' => $this->queryCommand(substr($payload, 1), $payload),
            'prepare' => $this->prepareCommand(substr($payload, 1), $payload),
            'execute' => $this->executeCommand($payload),
            'close' => $this->closeCommand($payload),
            'quit' => $this->quitCommand($payload),
            default => $this->forward($command, $payload),
        };
    }

    private function forward(string $command, string $payload, array $extra = []): void
    {
        $this->awaiting = ['command' => $command] + $extra;
        $this->toServer .= MysqlPacket::frame(0, $payload);
    }

    private function queryCommand(string $sql, string $payload): void
    {
        $exact = strtoupper(trim($sql));
        if ($this->intercept === 'sent' && $exact !== 'ROLLBACK') {
            throw new RelayRefusal('a query other than ROLLBACK after the intercepted COMMIT');
        }
        if ($exact === 'START TRANSACTION') {
            if ($this->txn !== null) {
                throw new RelayRefusal('START TRANSACTION inside an open transaction');
            }
            $this->forward('begin', $payload);
            return;
        }
        if ($exact === 'COMMIT') {
            $this->commitCommand($payload);
            return;
        }
        if ($exact === 'ROLLBACK') {
            $this->event('rollback-forwarded', ['txn' => $this->txn]);
            $this->forward('rollback', $payload);
            return;
        }
        if (preg_match(self::TX_CONTROL, $sql) === 1) {
            throw new RelayRefusal('ambiguous transaction control in a query');
        }
        $this->event('query', ['text' => substr($sql, 0, 80), 'txn' => $this->txn]);
        $this->forward('query', $payload);
    }

    private function commitCommand(string $payload): void
    {
        if (!$this->armed) {
            $this->forward('commit', $payload);
            return;
        }
        if ($this->intercept !== 'none') {
            throw new RelayRefusal('a second COMMIT on an armed connection');
        }
        if ($this->txn === null) {
            throw new RelayRefusal('COMMIT without an acknowledged START TRANSACTION');
        }
        if ($this->threadId === null) {
            throw new RelayRefusal('COMMIT without a server connection id');
        }
        $this->checkInterceptable();
        $this->intercept = 'pending';                           // never forwarded; observe() sends the ERR
        $this->event('commit-intercepted', ['txn' => $this->txn, 'threadId' => $this->threadId]);
    }

    /** The five expected executions end the transaction, each acknowledged; nothing but CLOSE follows the last. */
    private function checkInterceptable(): void
    {
        $execs = [];
        $afterLast = [];
        foreach ($this->events as $e) {
            if (($e['txn'] ?? null) !== $this->txn) {
                continue;
            }
            if ($e['type'] === 'execute') {
                $execs[] = $e;
                $afterLast = [];
            } elseif ($e['type'] !== 'begin') {
                $afterLast[] = $e['type'];
            }
        }
        $tail = array_slice($execs, -5);
        if (count($tail) !== 5) {
            throw new RelayRefusal('the transaction has fewer than five acknowledged executions');
        }
        foreach ($this->expected as $i => $sql) {
            $e = $tail[$i];
            if ($e['sql'] !== $sql) {
                throw new RelayRefusal('execution ' . ($i + 1) . ' of the last five is not the expected statement');
            }
            if ($e['response'] !== 'ok' || $e['affectedRows'] !== 1 || ($e['status'] & MysqlPacket::STATUS_IN_TRANS) === 0) {
                throw new RelayRefusal('expected statement ' . ($i + 1) . ' was not acknowledged with OK, one row and an open transaction');
            }
            if (count(array_filter($execs, static fn (array $x): bool => $x['sql'] === $sql)) !== 1) {
                throw new RelayRefusal('expected statement ' . ($i + 1) . ' executed more than once in the transaction');
            }
        }
        if (array_diff($afterLast, ['close']) !== []) {
            throw new RelayRefusal('a command other than COM_STMT_CLOSE between the last acknowledgment and COMMIT');
        }
    }

    private function prepareCommand(string $sql, string $payload): void
    {
        if (preg_match(self::TX_CONTROL, $sql) === 1) {
            throw new RelayRefusal('ambiguous transaction control in a prepared statement');
        }
        $this->forward('prepare', $payload, ['sql' => $sql]);
    }

    private function executeCommand(string $payload): void
    {
        if (strlen($payload) < 5) {
            throw new RelayRefusal('a truncated COM_STMT_EXECUTE');
        }
        $stmt = unpack('V', substr($payload, 1, 4))[1];
        if (!isset($this->statements[$stmt])) {
            throw new RelayRefusal('COM_STMT_EXECUTE of an unknown statement id');
        }
        $this->forward('execute', $payload, ['stmt' => $stmt, 'sql' => $this->statements[$stmt]]);
    }

    private function closeCommand(string $payload): void
    {
        if (strlen($payload) !== 5) {
            throw new RelayRefusal('a malformed COM_STMT_CLOSE');
        }
        $stmt = unpack('V', substr($payload, 1, 4))[1];
        unset($this->statements[$stmt]);
        $this->event('close', ['stmt' => $stmt, 'txn' => $this->txn]);
        $this->toServer .= MysqlPacket::frame(0, $payload); // no response
    }

    private function quitCommand(string $payload): void
    {
        $this->event('quit', ['txn' => $this->txn]);
        $this->toServer .= MysqlPacket::frame(0, $payload); // no response
        $this->phase = 'closed';
    }

    private function serverPacket(int $seq, string $payload): void
    {
        if ($this->phase === 'closed') {
            throw new RelayRefusal('a server packet after the session closed');
        }
        if ($this->phase === 'greeting') {
            $this->greeting($seq, $payload);
            $this->toClient .= MysqlPacket::frame($seq, $payload);
            return;
        }
        if ($this->phase === 'auth') {
            $this->handshakePacket('server', $seq, $payload);
            $this->toClient .= MysqlPacket::frame($seq, $payload);
            if ($payload !== '' && $payload[0] === "\x00") {
                $this->phase = 'command';
                $this->event('auth-ok', []);
            } elseif ($payload !== '' && $payload[0] === "\xFF") {
                throw new RelayRefusal('the server refused authentication');
            }
            return;
        }
        if (!$this->commandSeen) {
            throw new RelayRefusal('an unsolicited server packet');
        }
        if ($seq !== ($this->serverSeq + 1) % 256) {
            throw new RelayRefusal('an unexpected server sequence id ' . $seq);
        }
        $this->serverSeq = $seq;
        $this->toClient .= MysqlPacket::frame($seq, $payload);
        if ($this->awaiting === null) {
            return;                                             // a later packet of the same response (metadata, rows, EOF)
        }
        [$awaiting, $this->awaiting] = [$this->awaiting, null];
        $this->response($awaiting, $payload);
    }

    /** @param array{command: string, sql?: string, stmt?: int} $cmd */
    private function response(array $cmd, string $payload): void
    {
        $ok = MysqlPacket::ok($payload);
        $err = MysqlPacket::err($payload);
        switch ($cmd['command']) {
            case 'prepare':
                if ($payload !== '' && $payload[0] === "\x00" && strlen($payload) >= 12) {
                    $this->statements[unpack('V', substr($payload, 1, 4))[1]] = $cmd['sql'];
                    $this->event('prepare', ['stmt' => unpack('V', substr($payload, 1, 4))[1], 'sql' => $cmd['sql'], 'txn' => $this->txn]);
                } elseif ($err === null) {
                    throw new RelayRefusal('an unrecognised COM_STMT_PREPARE response');
                }
                return;
            case 'execute':
                $e = ['stmt' => $cmd['stmt'], 'sql' => $cmd['sql'], 'txn' => $this->txn,
                    'response' => $ok !== null ? 'ok' : ($err !== null ? 'err' : 'resultset'),
                    'affectedRows' => $ok['affectedRows'] ?? null, 'status' => $ok['status'] ?? 0];
                $this->event('execute', $e);
                $this->trackImplicitEnd($ok);
                return;
            case 'begin':
                if ($ok === null || ($ok['status'] & MysqlPacket::STATUS_IN_TRANS) === 0) {
                    throw new RelayRefusal('START TRANSACTION was not acknowledged with an open transaction');
                }
                $this->txn = ++$this->txnCount;
                $this->event('begin', ['txn' => $this->txn, 'status' => $ok['status']]);
                return;
            case 'commit':
                $this->event('commit-forwarded', ['txn' => $this->txn, 'response' => $ok !== null ? 'ok' : 'err', 'status' => $ok['status'] ?? 0]);
                if ($ok !== null) {
                    $this->txn = null;
                }
                return;
            case 'rollback':
                if ($this->intercept === 'sent') {
                    if ($ok === null || ($ok['status'] & MysqlPacket::STATUS_IN_TRANS) !== 0) {
                        throw new RelayRefusal('the ROLLBACK after the intercepted COMMIT was not acknowledged with the transaction closed');
                    }
                    $this->intercept = 'rolled-back';
                    $this->postObservationDue = true;
                    $this->event('rollback-confirmed', ['txn' => $this->txn, 'status' => $ok['status']]);
                } else {
                    $this->event('rollback', ['txn' => $this->txn, 'response' => $ok !== null ? 'ok' : 'err']);
                }
                $this->txn = $ok !== null ? null : $this->txn;
                return;
            default:
                $this->trackImplicitEnd($ok);
                return;
        }
    }

    /** An OK without the in-transaction flag inside an open transaction means the server ended it implicitly. */
    private function trackImplicitEnd(?array $ok): void
    {
        if ($this->txn !== null && $ok !== null && ($ok['status'] & MysqlPacket::STATUS_IN_TRANS) === 0) {
            if ($this->armed) {
                throw new RelayRefusal('the server reports the transaction ended implicitly');
            }
            $this->event('implicit-end', ['txn' => $this->txn]);
            $this->txn = null;
        }
    }

    private function greeting(int $seq, string $p): void
    {
        if ($seq !== 0 || $p === '' || $p[0] !== "\x0A") {
            throw new RelayRefusal('the server greeting is not protocol version 10');
        }
        $nul = strpos($p, "\x00", 1);
        if ($nul === false || strlen($p) < $nul + 1 + 4 + 8 + 1 + 2) {
            throw new RelayRefusal('a truncated server greeting');
        }
        $this->threadId = unpack('V', substr($p, $nul + 1, 4))[1];
        $this->handshakeSeq = 0;
        $this->phase = 'auth';
        $this->event('handshake', ['threadId' => $this->threadId, 'serverVersion' => substr($p, 1, $nul - 1)]);
    }

    private function handshakePacket(string $from, int $seq, string $p): void
    {
        if ($seq !== $this->handshakeSeq + 1) {
            throw new RelayRefusal('an unexpected handshake sequence id ' . $seq . ' from the ' . $from);
        }
        $this->handshakeSeq = $seq;
        if ($from !== 'client' || $seq !== 1) {
            return;
        }
        if (strlen($p) < 32) {
            throw new RelayRefusal('a truncated client handshake response');
        }
        $caps = unpack('V', substr($p, 0, 4))[1];
        $refused = [self::CLIENT_SSL => 'TLS', self::CLIENT_COMPRESS => 'compression', self::CLIENT_ZSTD_COMPRESSION => 'zstd compression',
            self::CLIENT_QUERY_ATTRIBUTES => 'query attributes', self::CLIENT_MULTI_STATEMENTS => 'multi-statements'];
        foreach ($refused as $bit => $name) {
            if (($caps & $bit) !== 0) {
                throw new RelayRefusal($name . ' is not supported');
            }
        }
        if (($caps & self::CLIENT_PROTOCOL_41) === 0) {
            throw new RelayRefusal('the client does not speak protocol 41');
        }
        if (($caps & self::CLIENT_MYSQL) === 0 && substr($p, 28, 4) !== "\x00\x00\x00\x00") {
            throw new RelayRefusal('MariaDB extended capabilities are not supported');
        }
        $this->event('client-capabilities', ['flags' => $caps]);
    }

    /** @param array<string, mixed> $fields */
    private function event(string $type, array $fields): void
    {
        $this->events[] = ['n' => count($this->events), 'type' => $type] + $fields;
    }
}

/**
 * The after-rollback observation (B1 correction B-1). information_schema.INNODB_TRX is a cached view that InnoDB
 * refreshes about every 100 ms, so a transaction can stay listed for a moment after its ROLLBACK was acknowledged.
 * Started only after the relay has validated that acknowledgment, this polls for the disappearance of the exact
 * transaction id seen at the intercept: every 150 ms (B-1a: InnoDB refreshes the cache only after ~100 ms without a
 * read, so faster polling keeps it stale), at most 2,000 ms, stopping as soon as it is gone. It
 * fails closed on a query error, a missing correlation id, or any row it cannot attribute to that transaction.
 * Disappearance from INNODB_TRX is only one signal; the B1 test still proves the rollback by direct reads.
 */
final class CommitFaultTrxPoller
{
    public const DEADLINE_MS = 2000;
    public const INTERVAL_MS = 150;

    /** An INNODB_TRX trx_id as a canonical decimal string (PDO may return int or string); null when not one. */
    public static function trxId(mixed $v): ?string
    {
        if (is_int($v) && $v >= 0) {
            return (string) $v;
        }
        return is_string($v) && preg_match('/^(0|[1-9][0-9]{0,19})$/', $v) === 1 ? $v : null;
    }

    /**
     * @param \Closure(): mixed $query the INNODB_TRX rows of the proxied connection's thread, each with trx_id
     * @param mixed $trxId the trx_id observed at the intercept
     * @param ?\Closure(): int $now monotonic nanoseconds (default hrtime)
     * @param ?\Closure(int): void $sleep microseconds (default usleep)
     * @return array{outcome: string, trxId: ?string, polls: int, elapsedMs: float, deadlineMs: int, intervalMs: int, final: mixed, error: ?string}
     *         outcome: gone | timeout | error | ambiguous | no-correlation; only "gone" is acceptable
     */
    public static function awaitGone(\Closure $query, mixed $trxId, int $deadlineMs = self::DEADLINE_MS, int $intervalMs = self::INTERVAL_MS, ?\Closure $now = null, ?\Closure $sleep = null): array
    {
        $now ??= static fn (): int => hrtime(true);
        $sleep ??= static function (int $us): void {
            usleep($us);
        };
        $id = self::trxId($trxId);
        $res = static fn (string $outcome, int $polls, float $ms, mixed $final, ?string $error): array => ['outcome' => $outcome, 'trxId' => $id,
            'polls' => $polls, 'elapsedMs' => round($ms, 3), 'deadlineMs' => $deadlineMs, 'intervalMs' => $intervalMs, 'final' => $final, 'error' => $error];
        if ($id === null) {
            return $res('no-correlation', 0, 0.0, null, 'no transaction id was observed at the intercept');
        }
        $start = $now();
        $polls = 0;
        while (true) {
            $polls++;
            try {
                $rows = $query();
            } catch (\Throwable $e) {
                return $res('error', $polls, ($now() - $start) / 1e6, null, get_class($e) . ($e instanceof \TamOs\Data\DatabaseError ? ' ' . $e->operation . ' ' . ($e->driverCode ?? '-') : ''));
            }
            $ms = ($now() - $start) / 1e6;
            if (!is_array($rows) || !array_is_list($rows)) {
                return $res('ambiguous', $polls, $ms, null, 'the observation is not a list of rows');
            }
            if ($rows === []) {
                return $res('gone', $polls, $ms, [], null);
            }
            if (count($rows) !== 1 || !is_array($rows[0]) || self::trxId($rows[0]['trx_id'] ?? null) !== $id) {
                return $res('ambiguous', $polls, $ms, $rows, 'a transaction other than the observed one is listed for the connection');
            }
            if ($ms >= $deadlineMs) {
                return $res('timeout', $polls, $ms, $rows, 'the transaction is still listed after ' . $deadlineMs . ' ms');
            }
            $sleep((int) max(1, min($intervalMs * 1000, ($deadlineMs - $ms) * 1000)));
        }
    }
}

/**
 * An independent re-check of a proxy result: it recomputes everything from the event log and the observer data
 * and never relies on the relay's own verdict, so a relay bug cannot turn into a false PASS.
 */
final class CommitFaultEvidence
{
    /**
     * @param ?array<string, mixed> $result the result file's contents (null when the proxy wrote none)
     * @param list<string> $expected the five wire SQL texts
     * @return list<string> every problem; empty only for a complete intercepted-and-rolled-back session
     */
    public static function armedProblems(?array $result, array $expected, ?int $exitCode): array
    {
        $p = self::common($result, $exitCode, true);
        if ($result === null) {
            return $p;
        }
        $events = is_array($result['events'] ?? null) ? $result['events'] : [];
        $types = array_column($events, 'type');
        $count = array_count_values($types);
        if (($result['verdict'] ?? null) !== 'intercepted-rolled-back') {
            $p[] = 'the verdict is not intercepted-rolled-back';
        }
        if (($count['commit-intercepted'] ?? 0) !== 1) {
            $p[] = 'not exactly one intercepted COMMIT';
        }
        if (($count['commit-forwarded'] ?? 0) !== 0) {
            $p[] = 'a COMMIT reached the server';
        }
        $at = array_search('commit-intercepted', $types, true);
        if ($at === false) {
            return $p;
        }
        $commit = $events[$at];
        $txn = $commit['txn'] ?? null;
        $handshake = array_values(array_filter($events, static fn (array $e): bool => $e['type'] === 'handshake'));
        if (count($handshake) !== 1 || ($handshake[0]['threadId'] ?? null) !== ($commit['threadId'] ?? false) || !is_int($commit['threadId'] ?? null)) {
            $p[] = 'the intercepted COMMIT is not correlated with the one server connection';
        }
        $execs = [];
        $lastExecAt = -1;
        foreach ($events as $i => $e) {
            if ($i < $at && $e['type'] === 'execute' && ($e['txn'] ?? null) === $txn) {
                $execs[] = $e;
                $lastExecAt = $i;
            }
        }
        $tail = array_slice($execs, -5);
        foreach ($expected as $i => $sql) {
            $e = $tail[$i] ?? null;
            if ($e === null || ($e['sql'] ?? null) !== $sql) {
                $p[] = 'expected statement ' . ($i + 1) . ' is not in place before the COMMIT';
                continue;
            }
            if (($e['response'] ?? null) !== 'ok' || ($e['affectedRows'] ?? null) !== 1 || (((int) ($e['status'] ?? 0)) & MysqlPacket::STATUS_IN_TRANS) === 0) {
                $p[] = 'expected statement ' . ($i + 1) . ' lacks a server OK with one row and an open transaction';
            }
        }
        if (count($tail) !== 5) {
            $p[] = 'fewer than five executions before the COMMIT';
        }
        for ($i = $lastExecAt + 1; $i < $at; $i++) {
            if ($events[$i]['type'] !== 'close') {
                $p[] = 'a ' . $events[$i]['type'] . ' between the last acknowledgment and the COMMIT';
            }
        }
        $after = static function (string $type, ?string $phase = null) use ($events, $at): ?int {
            foreach ($events as $i => $e) {
                if ($i > $at && $e['type'] === $type && ($phase === null || ($e['phase'] ?? null) === $phase)) {
                    return $i;
                }
            }
            return null;
        };
        $obs = $after('observation', 'intercept');
        $data = $obs === null ? null : ($events[$obs]['data'] ?? null);
        if (!is_array($data) || isset($data['error']) || ($data['skipped'] ?? false) === true) {
            $p[] = 'no observation of the open transaction at the intercepted COMMIT';
        } else {
            $trx = $data['trx'] ?? null;
            if (!is_array($trx) || count($trx) !== 1 || ($trx[0]['state'] ?? null) !== 'RUNNING') {
                $p[] = 'the observer did not see exactly one running transaction on the connection';
            } elseif (CommitFaultTrxPoller::trxId($trx[0]['trx_id'] ?? null) === null) {
                $p[] = 'the intercept observation has no transaction id to correlate';
            }
            if (!is_array($data['snapshot'] ?? null) || $data['snapshot'] === []) {
                $p[] = 'no dirty-read snapshot of the uncommitted rows';
            }
        }
        $err = $after('err-sent');
        $rbf = $after('rollback-forwarded');
        $rbc = $after('rollback-confirmed');
        if ($err === null || ($obs !== null && $err < $obs)) {
            $p[] = 'no injected ERR after the observation';
        }
        if ($rbf === null || $rbc === null || $rbc < $rbf || ($err !== null && $rbf < $err)) {
            $p[] = 'no forwarded ROLLBACK acknowledged by the server after the injected ERR';
        } elseif ((((int) ($events[$rbc]['status'] ?? 1)) & MysqlPacket::STATUS_IN_TRANS) !== 0) {
            $p[] = 'the server still reported an open transaction after ROLLBACK';
        }
        $post = $rbc === null ? null : $after('observation', 'after-rollback');
        $postData = $post === null ? null : ($events[$post]['data'] ?? null);
        if (!is_array($postData) || isset($postData['error']) || ($postData['skipped'] ?? false) === true || ($postData['trx'] ?? null) !== []) {
            $p[] = 'the observer did not confirm the connection has no open transaction after ROLLBACK';
        }
        $poll = is_array($postData) ? ($postData['poll'] ?? null) : null;
        $seen = is_array($data) && is_array($data['trx'] ?? null) && count($data['trx']) === 1 ? CommitFaultTrxPoller::trxId($data['trx'][0]['trx_id'] ?? null) : null;
        if (!is_array($poll) || ($poll['outcome'] ?? null) !== 'gone' || ($poll['final'] ?? null) !== [] || !is_int($poll['polls'] ?? null) || $poll['polls'] < 1
            || !is_numeric($poll['elapsedMs'] ?? null) || (float) $poll['elapsedMs'] > (float) ($poll['deadlineMs'] ?? -1) || ($poll['deadlineMs'] ?? null) > CommitFaultTrxPoller::DEADLINE_MS) {
            $p[] = 'the bounded after-rollback poll did not see the transaction disappear within its deadline';
        } elseif ($seen === null || ($poll['trxId'] ?? null) !== $seen) {
            $p[] = 'the after-rollback poll is not correlated with the transaction seen at the intercept';
        }
        return $p;
    }

    /** @return list<string> problems of an unarmed (transparency control) result */
    public static function transparentProblems(?array $result, ?int $exitCode): array
    {
        $p = self::common($result, $exitCode, false);
        if ($result === null) {
            return $p;
        }
        $events = is_array($result['events'] ?? null) ? $result['events'] : [];
        if (($result['verdict'] ?? null) !== 'transparent') {
            $p[] = 'the verdict is not transparent';
        }
        $types = array_column($events, 'type');
        if (in_array('commit-intercepted', $types, true) || in_array('err-sent', $types, true)) {
            $p[] = 'an unarmed proxy intercepted a COMMIT';
        }
        $commits = array_filter($events, static fn (array $e): bool => $e['type'] === 'commit-forwarded' && ($e['response'] ?? null) === 'ok');
        if ($commits === []) {
            $p[] = 'no COMMIT was forwarded and acknowledged';
        }
        return $p;
    }

    /** @return list<string> */
    private static function common(?array $result, ?int $exitCode, bool $armed): array
    {
        if ($result === null) {
            return ['the proxy wrote no result (terminated early or never finished)'];
        }
        $p = [];
        if ($exitCode !== 0) {
            $p[] = 'the proxy exited with ' . var_export($exitCode, true);
        }
        if (($result['complete'] ?? false) !== true) {
            $p[] = 'the result is not marked complete';
        }
        if (($result['armed'] ?? null) !== $armed) {
            $p[] = 'the result was produced in the wrong mode';
        }
        if (($result['failure'] ?? null) !== null) {
            $p[] = 'the proxy refused: ' . (string) $result['failure'];
        }
        foreach ((array) ($result['events'] ?? []) as $e) {
            if (is_array($e) && ($e['type'] ?? null) === 'refusal') {
                $p[] = 'refusal event: ' . (string) ($e['reason'] ?? '');
            }
        }
        return $p;
    }
}

/**
 * Retains the proxy's original result.json bytes for independent review (B1 evidence retention). The bytes are
 * copied unchanged — never decoded and re-encoded — into a run-unique file under a persistent root that lies
 * outside the proxy's temporary directory, then read back and compared by SHA-256. A sidecar <file>.sha256 in
 * sha256sum format records the checksum. Nothing is reconstructed: a missing result is reported, not invented.
 */
final class CommitFaultEvidenceStore
{
    /** The persistent root: TAMOS_B1_EVIDENCE_DIR when set, else server/tests/evidence/commit-fault-proxy (git-ignored). */
    public static function defaultRoot(): string
    {
        $env = getenv('TAMOS_B1_EVIDENCE_DIR');
        return is_string($env) && $env !== '' ? $env : dirname(__DIR__) . DIRECTORY_SEPARATOR . 'evidence' . DIRECTORY_SEPARATOR . 'commit-fault-proxy';
    }

    /** Creates the root when needed and returns its real path; throws when it is unusable (fail closed, before any run). */
    public static function prepareRoot(string $root): string
    {
        if (!is_dir($root) && !@mkdir($root, 0700, true) && !is_dir($root)) {
            throw new \RuntimeException('evidence: cannot create the evidence directory ' . $root);
        }
        $real = realpath($root);
        if ($real === false || !is_dir($real) || !is_writable($real)) {
            throw new \RuntimeException('evidence: the evidence directory is not a writable directory: ' . $root);
        }
        return $real;
    }

    /**
     * Copies $source byte for byte into a new run-unique file under $root and verifies the copy.
     * Returns null when $source does not exist (nothing to retain). Throws, leaving $source untouched, when the
     * copy cannot be made or does not read back identical. `problem` is non-null when the retained bytes are not a
     * complete result object (empty, truncated or corrupted): they are kept as found and are never evidence.
     *
     * @return ?array{path: string, sha256: string, bytes: int, runId: string, problem: ?string, result: ?array<string, mixed>}
     */
    public static function preserve(string $source, string $root): ?array
    {
        clearstatcache();
        if (!file_exists($source)) {
            return null;
        }
        $bytes = @file_get_contents($source);
        if (!is_string($bytes)) {
            throw new \RuntimeException('evidence: cannot read ' . $source);
        }
        $sha = hash('sha256', $bytes);
        $runId = gmdate('Ymd\THis\Z') . '-' . getmypid() . '-' . bin2hex(random_bytes(6));
        $path = rtrim($root, '\\/') . DIRECTORY_SEPARATOR . 'b1-proxy-result-' . $runId . '.json';
        $h = @fopen($path, 'xb');                                      // exclusive create: never overwrites a previous run
        if ($h === false) {
            throw new \RuntimeException('evidence: cannot create ' . $path . '; the original stays at ' . $source);
        }
        $written = fwrite($h, $bytes);
        $flushed = fflush($h);
        fclose($h);
        clearstatcache();
        $back = @file_get_contents($path);
        $again = @file_get_contents($source);
        if ($written !== strlen($bytes) || !$flushed || !is_string($back) || hash('sha256', $back) !== $sha || !is_string($again) || hash('sha256', $again) !== $sha) {
            throw new \RuntimeException('evidence: the retained copy ' . $path . ' does not read back identical; the original stays at ' . $source);
        }
        $mtime = @filemtime($source);
        if (is_int($mtime)) {
            @touch($path, $mtime);
        }
        if (@file_put_contents($path . '.sha256', $sha . ' *' . basename($path) . "\n", LOCK_EX) === false) {
            throw new \RuntimeException('evidence: cannot write the checksum ' . $path . '.sha256; the original stays at ' . $source);
        }
        [$result, $problem] = self::decode($bytes);
        return ['path' => $path, 'sha256' => $sha, 'bytes' => strlen($bytes), 'runId' => $runId, 'problem' => $problem, 'result' => $result];
    }

    /**
     * Independently re-checks a retained file from disk against what collect() returned: present, readable, its
     * bytes matching the recorded SHA-256 and the sidecar, a complete result object, and decoding to the same result.
     *
     * @param array<string, mixed> $out the array stop() or kill() returned
     * @return list<string> every problem; empty only for intact retained evidence
     */
    public static function retainedProblems(array $out): array
    {
        $ev = $out['evidence'] ?? null;
        if (!is_array($ev) || !is_string($ev['path'] ?? null) || !is_string($ev['sha256'] ?? null)) {
            return ['no retained evidence (the proxy wrote no result)'];
        }
        clearstatcache();
        $bytes = is_file($ev['path']) ? @file_get_contents($ev['path']) : false;
        if (!is_string($bytes)) {
            return ['the retained evidence file is missing or unreadable: ' . $ev['path']];
        }
        $p = [];
        $sha = hash('sha256', $bytes);
        if ($sha !== $ev['sha256'] || strlen($bytes) !== ($ev['bytes'] ?? null)) {
            $p[] = 'the retained evidence does not match its recorded SHA-256';
        }
        $side = @file_get_contents($ev['path'] . '.sha256');
        if (!is_string($side) || $side !== $ev['sha256'] . ' *' . basename($ev['path']) . "\n") {
            $p[] = 'the checksum sidecar is missing or does not match';
        }
        [$result, $problem] = self::decode($bytes);
        if ($problem !== null) {
            $p[] = 'the retained result is ' . $problem;
        } elseif ($result !== ($out['result'] ?? null)) {
            $p[] = 'the retained result differs from the result the test used';
        }
        return $p;
    }

    /** @return array{0: ?array<string, mixed>, 1: ?string} */
    private static function decode(string $bytes): array
    {
        if ($bytes === '') {
            return [null, 'empty'];
        }
        try {
            $d = json_decode($bytes, true, 512, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            return [null, 'not valid JSON (truncated or corrupted)'];
        }
        if (!is_array($d) || array_is_list($d) || ($d['complete'] ?? null) !== true || !is_array($d['events'] ?? null)) {
            return [null, 'not a complete result object'];
        }
        return [$d, null];
    }
}

/** Starts and stops tests/Support/commit-fault-proxy.php as its own process. */
final class CommitFaultProxyProcess
{
    /** @var resource */
    private $proc;
    /** @var array<int, resource> */
    private array $pipes;

    private function __construct(public readonly int $port, public readonly string $dir, private readonly string $evidenceRoot, $proc, array $pipes)
    {
        $this->proc = $proc;
        $this->pipes = $pipes;
    }

    /**
     * PDO sends a named-placeholder statement to the server with each :name replaced by '?' (native prepares);
     * this is that wire text, used to recognise the expected statements. Quoted literals are left alone.
     */
    public static function wireSql(string $sql): string
    {
        return (string) preg_replace_callback("/'(?:[^'\\\\]|\\\\.)*'|\"(?:[^\"\\\\]|\\\\.)*\"|:[A-Za-z_][A-Za-z0-9_]*/",
            static fn (array $m): string => $m[0][0] === ':' ? '?' : $m[0], $sql);
    }

    /**
     * @param array<string, mixed> $spec see commit-fault-proxy.php
     * @param ?string $evidenceRoot where result.json is retained (default CommitFaultEvidenceStore::defaultRoot())
     */
    public static function start(array $spec, ?string $evidenceRoot = null): self
    {
        $root = CommitFaultEvidenceStore::prepareRoot($evidenceRoot ?? CommitFaultEvidenceStore::defaultRoot());
        $dir = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'tamos-b1-proxy-' . bin2hex(random_bytes(6));
        if (!mkdir($dir, 0700)) {
            throw new \RuntimeException('proxy: cannot create its directory');
        }
        $realDir = (string) realpath($dir);
        if (str_starts_with(strtolower($root . DIRECTORY_SEPARATOR), strtolower($realDir . DIRECTORY_SEPARATOR))) {
            rmdir($dir);
            throw new \RuntimeException('evidence: the evidence directory lies inside the proxy\'s temporary directory');
        }
        file_put_contents($dir . '/spec.json', json_encode($spec, JSON_THROW_ON_ERROR));
        $cmd = [PHP_BINARY];
        if (php_ini_loaded_file() === false) {
            $cmd[] = '-n';
        }
        array_push($cmd, __DIR__ . '/commit-fault-proxy.php', $dir);
        $proc = proc_open($cmd, [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes, null, getenv());
        if (!is_resource($proc)) {
            throw new \RuntimeException('proxy: did not start');
        }
        fclose($pipes[0]);
        $line = fgets($pipes[1]);                                // READY <port>, or EOF when it refused to start
        if (!is_string($line) || preg_match('/^READY (\d{1,5})\s*$/', $line, $m) !== 1) {
            $err = (string) stream_get_contents($pipes[2]);
            fclose($pipes[1]);
            fclose($pipes[2]);
            $code = proc_close($proc);
            throw new \RuntimeException('proxy: refused to start (exit ' . $code . '): ' . trim($err));
        }
        return new self((int) $m[1], $dir, $root, $proc, $pipes);
    }

    /**
     * Asks the proxy to finish, waits for it and returns its exit code, its result (null when it wrote none or it
     * is not a complete result object) and the retained evidence (null when there was no result.json to retain).
     *
     * @return array{exitCode: int, result: ?array<string, mixed>, stderr: string, evidence: ?array{path: string, sha256: string, bytes: int, runId: string, problem: ?string}}
     */
    public function stop(): array
    {
        touch($this->dir . '/stop');
        return $this->collect();
    }

    /** Kills the proxy without letting it finish (premature termination). */
    public function kill(): array
    {
        proc_terminate($this->proc);
        return $this->collect();
    }

    private function collect(): array
    {
        $stderr = (string) stream_get_contents($this->pipes[2]);
        fclose($this->pipes[1]);
        fclose($this->pipes[2]);
        $code = proc_close($this->proc);
        // Retained BEFORE any cleanup; a failure throws here and leaves the temporary directory and its result.json in place.
        $evidence = CommitFaultEvidenceStore::preserve($this->dir . DIRECTORY_SEPARATOR . 'result.json', $this->evidenceRoot);
        $result = $evidence['result'] ?? null;
        unset($evidence['result']);
        foreach (['spec.json', 'result.json', 'stop'] as $f) {
            if (is_file($this->dir . '/' . $f)) {
                unlink($this->dir . '/' . $f);
            }
        }
        if (is_dir($this->dir)) {
            rmdir($this->dir);
        }
        return ['exitCode' => $code, 'result' => $result, 'stderr' => $stderr, 'evidence' => $evidence];
    }
}
