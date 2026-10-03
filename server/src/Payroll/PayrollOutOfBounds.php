<?php
declare(strict_types=1);

namespace TamOs\Payroll;

/**
 * A payroll calculation whose exact result would not fit its integer or column bounds. It is a
 * data condition, not a defect: the generate request is refused (409) and nothing is written —
 * never a wrapped, truncated or float result.
 */
final class PayrollOutOfBounds extends \RuntimeException
{
}
