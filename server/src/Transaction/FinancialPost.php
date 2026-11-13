<?php
declare(strict_types=1);

namespace TamOs\Transaction;

/**
 * The four fixed Financial Posts (Phase 1, D-INT-1): the organisational unit a general income or
 * expense transaction is allocated to. A Financial Post is NOT a transaction category — the
 * category is a separate, free-text field. The same closed list is the CHECK of migration 0036
 * (finance_transactions_financial_post), so neither the server nor the database admits another
 * code. Payroll is never allocated to a Financial Post: it is reported as its own line.
 *
 * Keep the one-entry-per-line form: tools/verify-backend-boundary.js parses it and requires the
 * codes to equal migration 0036's CHECK and js/core/transaction-api.js FINANCIAL_POSTS.
 */
enum FinancialPost: string
{
    case Ga = 'GA';
    case Npip = 'NPIP';
    case Tjb = 'TJB';
    case Drone = 'DRONE';

    public function displayName(): string
    {
        return match ($this) {
            self::Ga => 'GA',
            self::Npip => 'NP & IP',
            self::Tjb => 'TJB',
            self::Drone => 'Drone',
        };
    }

    /** @return list<string> the codes, in display order */
    public static function codes(): array
    {
        return array_map(static fn (self $p): string => $p->value, self::cases());
    }
}
