<?php
declare(strict_types=1);

namespace TamOs\Policy;

/**
 * The server ACTION vocabulary: exactly the 20 values of js/core/authz.js ACTIONS (SDR-0002 §7),
 * with each action's rule (authz.js POLICY) and the entity its record belongs to (authz.js
 * ACTION_RESOURCE_ENTITY; null = the action takes no record).
 *
 * A string that is not one of these values has no Action (Action::tryFrom → null), and Policy
 * accepts only an Action, so an unknown action can never be authorized. Both matches list every
 * case with no default arm.
 *
 * Keep the one-entry-per-line form: tools/verify-backend-boundary.js parses this file and fails
 * the build unless values, rules and entities equal the frontend's.
 */
enum Action: string
{
    case EmployeeCreate = 'employee.create';
    case EmployeeUpdate = 'employee.update';
    case EmployeeDelete = 'employee.delete';
    case ContractCreate = 'contract.create';
    case ContractUpdate = 'contract.update';
    case ContractDelete = 'contract.delete';
    case PayrollManage = 'payroll.manage';
    case OvertimeSubmitSelf = 'overtime.submitSelf';
    case OvertimeCreateSelfDraft = 'overtime.createSelfDraft';
    case OvertimeUpdateSelfDraft = 'overtime.updateSelfDraft';
    case OvertimeDeleteSelfDraft = 'overtime.deleteSelfDraft';
    case OvertimeManage = 'overtime.manage';
    case FinanceExecute = 'finance.execute';
    case FinanceManage = 'finance.manage';
    case ImportCommit = 'import.commit';
    case SupplementalManage = 'supplemental.manage';
    case SettingsManage = 'settings.manage';
    case ImportUndo = 'import.undo';
    case DataRestore = 'data.restore';
    case DataReset = 'data.reset';

    public function rule(): Rule
    {
        return match ($this) {
            self::EmployeeCreate => Rule::CeoOnly,
            self::EmployeeUpdate => Rule::CeoOnly,
            self::EmployeeDelete => Rule::CeoOnly,
            self::ContractCreate => Rule::CeoOnly,
            self::ContractUpdate => Rule::CeoOnly,
            self::ContractDelete => Rule::CeoOnly,
            self::PayrollManage => Rule::CeoOnly,
            self::OvertimeSubmitSelf => Rule::CeoOrOwnDraft,
            self::OvertimeCreateSelfDraft => Rule::CeoOrOwnDraft,
            self::OvertimeUpdateSelfDraft => Rule::CeoOrOwnDraft,
            self::OvertimeDeleteSelfDraft => Rule::CeoOrOwnDraft,
            self::OvertimeManage => Rule::CeoOnly,
            self::FinanceExecute => Rule::CeoOnly,
            self::FinanceManage => Rule::CeoOnly,
            self::ImportCommit => Rule::CeoOnly,
            self::SupplementalManage => Rule::CeoOnly,
            self::SettingsManage => Rule::CeoOnly,
            self::ImportUndo => Rule::CeoOnly,
            self::DataRestore => Rule::CeoOnly,
            self::DataReset => Rule::CeoOnly,
        };
    }

    public function entity(): ?string
    {
        return match ($this) {
            self::EmployeeCreate => null,
            self::EmployeeUpdate => 'employee',
            self::EmployeeDelete => 'employee',
            self::ContractCreate => null,
            self::ContractUpdate => 'contract',
            self::ContractDelete => 'contract',
            self::PayrollManage => 'payrollPlan',
            self::OvertimeSubmitSelf => 'overtime',
            self::OvertimeCreateSelfDraft => 'overtime',
            self::OvertimeUpdateSelfDraft => 'overtime',
            self::OvertimeDeleteSelfDraft => 'overtime',
            self::OvertimeManage => 'overtime',
            self::FinanceExecute => null,
            self::FinanceManage => null,
            self::ImportCommit => null,
            self::SupplementalManage => null,
            self::SettingsManage => null,
            self::ImportUndo => null,
            self::DataRestore => null,
            self::DataReset => null,
        };
    }
}
