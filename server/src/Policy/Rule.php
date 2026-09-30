<?php
declare(strict_types=1);

namespace TamOs\Policy;

/**
 * The two authorization rules the 20 ACTIONS use (js/core/authz.js POLICY):
 *
 *   CeoOnly        the CEO; never an Employee
 *   CeoOrOwnDraft  the CEO; an Employee only on their own in-scope record while it is a Draft
 *
 * There is no third rule, so no action can be given a broader one by mistake.
 */
enum Rule
{
    case CeoOnly;
    case CeoOrOwnDraft;
}
