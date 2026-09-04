/**
 * lib/lead-workflow.js
 * Workflow logic and single source of truth for Lead Statuses and Reasons.
 */

const STATUS_CATALOG = {
  NEW: 'Nuevo',
  VALIDATED: 'Validado',
  CONTACT_PENDING: 'Contacto pendiente',
  CONTACTED: 'Contactado',
  SIM_PENDING: 'SIM pendiente',
  SIM_READY: 'SIM lista',
  ACTIVATION_PENDING: 'Activación pendiente',
  ACTIVATED: 'Activado',
  PORTABILITY_PENDING: 'Cambio pendiente',
  COMPLETED: 'Completado',
  REJECTED: 'Rechazado',
  CANCELLED: 'Cancelado'
};

const REASON_CATALOG = {
  INVALID_DATA: 'Datos inválidos',
  DUPLICATE: 'Duplicado',
  UNREACHABLE: 'Inlocalizable',
  CUSTOMER_DECLINED: 'Cliente declinó',
  SIM_ISSUE: 'Problema SIM',
  ACTIVATION_ISSUE: 'Problema activación',
  PORTABILITY_REJECTED: 'Portabilidad rechazada',
  POLICY_REJECTED: 'Rechazado por política',
  OTHER_OPERATIONAL: 'Otro operativo'
};

function isValidStatus(status) {
  return Object.prototype.hasOwnProperty.call(STATUS_CATALOG, status);
}

function isValidReason(reason) {
  return Object.prototype.hasOwnProperty.call(REASON_CATALOG, reason);
}

function isReasonRequired(status) {
  return status === 'REJECTED' || status === 'CANCELLED';
}

function validateTransitionPayload(status, reason) {
  if (!isValidStatus(status)) {
    return { valid: false, error: 'Invalid status' };
  }
  
  if (isReasonRequired(status)) {
    if (!reason) {
      return { valid: false, error: 'Reason is required for this status' };
    }
    if (!isValidReason(reason)) {
      return { valid: false, error: 'Invalid reason code' };
    }
  } else {
    if (reason) {
      return { valid: false, error: 'Reason is not allowed for this status' };
    }
  }

  return { valid: true };
}

module.exports = {
  STATUS_CATALOG,
  REASON_CATALOG,
  isValidStatus,
  isValidReason,
  isReasonRequired,
  validateTransitionPayload
};
