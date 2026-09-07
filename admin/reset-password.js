document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('resetForm');
  const errorDiv = document.getElementById('errorMessage');
  const successDiv = document.getElementById('successMessage');
  const submitBtn = document.getElementById('submitBtn');
  const submitText = document.getElementById('submitText');
  const submitSpinner = document.getElementById('submitSpinner');
  
  const togglePasswordBtn = document.getElementById('togglePasswordBtn');
  const passwordInput = document.getElementById('password');
  
  const togglePasswordConfirmBtn = document.getElementById('togglePasswordConfirmBtn');
  const passwordConfirmInput = document.getElementById('passwordConfirm');

  // Parse token from fragment
  // Example: #token=abcdef...
  let token = null;
  const hash = window.location.hash.substring(1);
  const params = new URLSearchParams(hash);
  token = params.get('token');

  if (!token) {
    errorDiv.textContent = 'Enlace de recuperación inválido o incompleto.';
    errorDiv.hidden = false;
    form.hidden = true;
  }

  // Toggle password visibility
  if (togglePasswordBtn && passwordInput) {
    togglePasswordBtn.addEventListener('click', () => {
      const isPassword = passwordInput.type === 'password';
      passwordInput.type = isPassword ? 'text' : 'password';
      togglePasswordBtn.setAttribute('aria-label', isPassword ? 'Ocultar contraseña' : 'Mostrar contraseña');
    });
  }

  if (togglePasswordConfirmBtn && passwordConfirmInput) {
    togglePasswordConfirmBtn.addEventListener('click', () => {
      const isPassword = passwordConfirmInput.type === 'password';
      passwordConfirmInput.type = isPassword ? 'text' : 'password';
      togglePasswordConfirmBtn.setAttribute('aria-label', isPassword ? 'Ocultar contraseña' : 'Mostrar contraseña');
    });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const password = passwordInput.value;
    const passwordConfirm = passwordConfirmInput.value;
    
    errorDiv.hidden = true;
    errorDiv.textContent = '';
    
    if (password.length < 8) {
      errorDiv.textContent = 'La contraseña debe tener al menos 8 caracteres.';
      errorDiv.hidden = false;
      return;
    }

    if (password !== passwordConfirm) {
      errorDiv.textContent = 'Las contraseñas no coinciden.';
      errorDiv.hidden = false;
      return;
    }

    submitBtn.disabled = true;
    submitText.textContent = 'Restableciendo…';
    submitSpinner.hidden = false;

    try {
      const response = await fetch('/api/admin/password-reset/confirm', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ token, password })
      });

      const data = await response.json();

      if (response.ok && data.ok) {
        successDiv.textContent = 'Contraseña actualizada. Ya puedes iniciar sesión con tu nueva contraseña.';
        successDiv.hidden = false;
        form.hidden = true;
        // Optionally clean up fragment token so it doesn't stay in URL
        window.history.replaceState(null, '', window.location.pathname);
      } else {
        errorDiv.textContent = data.error || 'Error al restablecer la contraseña.';
        errorDiv.hidden = false;
        
        submitBtn.disabled = false;
        submitText.textContent = 'Restablecer contraseña';
        submitSpinner.hidden = true;
      }
    } catch (err) {
      errorDiv.textContent = 'Error de conexión. Intente nuevamente.';
      errorDiv.hidden = false;
      
      submitBtn.disabled = false;
      submitText.textContent = 'Restablecer contraseña';
      submitSpinner.hidden = true;
    }
  });
});
