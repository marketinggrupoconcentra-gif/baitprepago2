// Trunca strings para evitar inyecciones muy largas en el campo
export function truncate(str, max) {
  if (!str || typeof str !== 'string') return null;
  return str.slice(0, max || 255);
}

export function validateLeadPayload(body) {
  // Validaciones básicas del lado del servidor
  const phone = (body.phone || '').toString().replace(/\D/g, '').slice(0, 10);
  const nip = (body.nip || '').toString().replace(/\D/g, '').slice(0, 4);
  const consent = body.consent === true; // or however we pass it, but usually standard is string/boolean

  const errors = [];
  if (!/^\d{10}$/.test(phone)) errors.push('phone_invalid');
  if (!/^\d{4}$/.test(nip)) errors.push('nip_invalid'); // Even if we don't save it, we validate its presence and format to block spam
  
  // NIP validation is performed, but NIP is NOT returned or stored.
  // We validate phoneConfirm on client, but on server we just care about phone.
  
  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    data: {
      phone,
      // NIP is deliberately omitted here so it's not passed to the DB layer
    }
  };
}
