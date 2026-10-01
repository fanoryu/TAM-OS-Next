<?php
declare(strict_types=1);

namespace TamOs\Auth;

/**
 * Keys derived for login, activation and password-change throttling and the security-event
 * log. Pure functions: no I/O.
 *
 * The client IP is REMOTE_ADDR only (no forwarding header is trusted until deployment
 * evidence establishes one). IPv6 addresses share a /64 bucket, because a single host can
 * trivially rotate within its /64; an IPv4-mapped IPv6 address is treated as IPv4; a missing
 * or invalid address falls into one shared "none" bucket.
 *
 * The email hash is an unkeyed SHA-256 of the candidate address: it keeps raw addresses (and
 * passwords mistyped into the email field) out of the log, but anyone holding the table can
 * confirm a guessed address. That dictionary risk is documented and accepted for BF-3A.
 */
final class LoginKeys
{
    public static function accountBucket(string $emailCandidate): string
    {
        return hash('sha256', 'acct:' . $emailCandidate);
    }

    public static function ipBucket(?string $remoteAddr): string
    {
        return hash('sha256', 'ip:' . self::ipKey($remoteAddr));
    }

    public static function emailHash(string $emailCandidate): string
    {
        return hash('sha256', 'email:' . $emailCandidate);
    }

    /** BF-3B: failed activation redemptions per client IP (the token itself names no account). */
    public static function activationIpBucket(?string $remoteAddr): string
    {
        return hash('sha256', 'activate-ip:' . self::ipKey($remoteAddr));
    }

    /**
     * BF-3D: password-recovery requests per address candidate. Computed for every candidate —
     * unknown and invalid addresses included — so the limiter behaves the same for all.
     */
    public static function recoveryAccountBucket(string $emailCandidate): string
    {
        return hash('sha256', 'recover-acct:' . $emailCandidate);
    }

    /** BF-3D: password-recovery requests per client IP. */
    public static function recoveryIpBucket(?string $remoteAddr): string
    {
        return hash('sha256', 'recover-ip:' . self::ipKey($remoteAddr));
    }

    /** BF-3D: failed password-reset redemptions per client IP (the token itself names no account). */
    public static function resetIpBucket(?string $remoteAddr): string
    {
        return hash('sha256', 'reset-ip:' . self::ipKey($remoteAddr));
    }

    /** BF-3B: wrong current passwords per authenticated user on password change. */
    public static function passwordChangeBucket(string $userId): string
    {
        return hash('sha256', 'pwchange:' . $userId);
    }

    /** "4:<address>", "6:<first 64 bits, hex>" or "none". */
    public static function ipKey(?string $remoteAddr): string
    {
        $valid = $remoteAddr !== null && filter_var($remoteAddr, FILTER_VALIDATE_IP) !== false;
        $packed = $valid ? inet_pton($remoteAddr) : false;
        if (!is_string($packed)) {
            return 'none';
        }
        if (strlen($packed) === 16 && str_starts_with($packed, str_repeat("\0", 10) . "\xff\xff")) {
            $packed = substr($packed, 12);
        }
        if (strlen($packed) === 4) {
            return '4:' . inet_ntop($packed);
        }
        return strlen($packed) === 16 ? '6:' . bin2hex(substr($packed, 0, 8)) : 'none';
    }
}
