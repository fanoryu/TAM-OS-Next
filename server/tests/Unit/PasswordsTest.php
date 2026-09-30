<?php
declare(strict_types=1);

use TamOs\Auth\Passwords;
use function TamOs\Tests\assertSame;
use function TamOs\Tests\assertThrows;
use function TamOs\Tests\assertTrue;

return [
    'the algorithm is Argon2id when this PHP has it, else bcrypt cost 12, with pinned options' => static function (): void {
        if (defined('PASSWORD_ARGON2ID')) {
            assertSame([PASSWORD_ARGON2ID, ['memory_cost' => 65536, 'time_cost' => 4, 'threads' => 1]], [Passwords::algorithm(), Passwords::options()]);
        } else {
            assertSame([PASSWORD_BCRYPT, ['cost' => 12]], [Passwords::algorithm(), Passwords::options()]);
        }
    },
    'hash then verify: right password true, wrong password false' => static function (): void {
        $hash = Passwords::hash('correct horse battery');
        assertTrue(Passwords::verify('correct horse battery', $hash), 'right password');
        assertTrue(!Passwords::verify('correct horse batterx', $hash), 'wrong password');
        assertTrue(!Passwords::verify('', $hash), 'empty');
        assertSame(false, Passwords::needsRehash($hash), 'a fresh hash is current');
        $info = Passwords::describe($hash);
        assertSame(Passwords::options(), $info['options'], 'fresh hash uses the pinned options');
    },
    'the selected dummy hash has exactly the runtime algorithm and options and needs no rehash' => static function (): void {
        $dummy = Passwords::dummyHash();
        $info = Passwords::describe($dummy);
        $expectedName = defined('PASSWORD_ARGON2ID') ? 'argon2id' : 'bcrypt';
        assertSame([$expectedName, Passwords::options()], [$info['algoName'], $info['options']]);
        assertSame(false, Passwords::needsRehash($dummy));
        // Both committed dummies are well-formed for their own algorithm.
        assertSame('bcrypt', Passwords::describe(Passwords::DUMMY_HASH_BCRYPT)['algoName']);
        assertSame(Passwords::BCRYPT_OPTIONS, Passwords::describe(Passwords::DUMMY_HASH_BCRYPT)['options']);
        if (defined('PASSWORD_ARGON2ID')) {
            assertSame(['argon2id', Passwords::ARGON2ID_OPTIONS], array_values(Passwords::describe(Passwords::DUMMY_HASH_ARGON2ID)));
        }
    },
    'no hash (unknown account or not activated) runs a dummy verification and is false' => static function (): void {
        assertSame(false, Passwords::verify('any password at all', null));
        assertSame(false, Passwords::verify('', null));
    },
    'input policy: empty, over 72 bytes, or NUL is never accepted, even against its own hash' => static function (): void {
        $max = str_repeat('é', 36); // 72 bytes
        assertSame(72, strlen($max));
        assertTrue(Passwords::isAcceptableInput($max), '72 bytes is acceptable');
        assertTrue(Passwords::verify($max, Passwords::hash($max)), '72 bytes verifies');
        $over = $max . 'a';
        assertTrue(!Passwords::isAcceptableInput($over), '73 bytes is not');
        $bcrypt72 = password_hash(substr($over, 0, 72), PASSWORD_BCRYPT, ['cost' => 4]);
        assertSame(false, Passwords::verify($over, $bcrypt72), 'no bcrypt truncation match past 72 bytes');
        assertTrue(!Passwords::isAcceptableInput(''), 'empty');
        assertTrue(!Passwords::isAcceptableInput("abc\0def"), 'NUL');
        assertThrows(InvalidArgumentException::class, static fn () => Passwords::hash($over));
        assertThrows(InvalidArgumentException::class, static fn () => Passwords::hash(''));
    },
    'rehash is detected for weaker or older parameters' => static function (): void {
        assertTrue(Passwords::needsRehash(password_hash('pw-rehash-test', PASSWORD_BCRYPT, ['cost' => 4])), 'bcrypt cost 4');
        if (defined('PASSWORD_ARGON2ID')) {
            assertTrue(Passwords::needsRehash(password_hash('pw-rehash-test', PASSWORD_ARGON2ID, ['memory_cost' => 1024, 'time_cost' => 1, 'threads' => 1])), 'weak argon2id');
        }
    },
];
