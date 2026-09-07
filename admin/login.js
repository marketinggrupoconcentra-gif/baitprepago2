document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('loginForm');
  const errorDiv = document.getElementById('errorMessage');
  const submitBtn = document.getElementById('submitBtn');
  const submitText = document.getElementById('submitText');
  const submitSpinner = document.getElementById('submitSpinner');
  const loginShell = document.getElementById('loginShell');
  
  const togglePasswordBtn = document.getElementById('togglePasswordBtn');
  const passwordInput = document.getElementById('password');
  const forgotPasswordBtn = document.getElementById('forgotPasswordBtn');
  
  // Recovery elements
  const loginCard = document.getElementById('loginCard');
  const recoveryCard = document.getElementById('recoveryCard');
  const backToLoginBtn = document.getElementById('backToLoginBtn');
  const recoveryForm = document.getElementById('recoveryForm');
  const recoveryErrorMessage = document.getElementById('recoveryErrorMessage');
  const recoverySuccessMessage = document.getElementById('recoverySuccessMessage');
  const recoverySubmitBtn = document.getElementById('recoverySubmitBtn');
  const recoverySubmitText = document.getElementById('recoverySubmitText');
  const recoverySpinner = document.getElementById('recoverySpinner');

  // Prevent flash of UI if already authenticated
  fetch('/api/admin/session')
    .then(res => res.json())
    .then(data => {
      if (data.authenticated) {
        window.location.href = '/admin/dashboard';
      } else {
        // Show shell if not authenticated
        loginShell.classList.remove('login-shell-pending');
      }
    })
    .catch(() => {
      // Fallback, show shell if check fails
      loginShell.classList.remove('login-shell-pending');
    });

  // Toggle password visibility
  if (togglePasswordBtn && passwordInput) {
    togglePasswordBtn.addEventListener('click', () => {
      const isPassword = passwordInput.type === 'password';
      passwordInput.type = isPassword ? 'text' : 'password';
      togglePasswordBtn.setAttribute('aria-label', isPassword ? 'Ocultar contraseña' : 'Mostrar contraseña');
    });
  }

  // Forgot password UI Toggle
  if (forgotPasswordBtn && loginCard && recoveryCard) {
    forgotPasswordBtn.addEventListener('click', () => {
      loginCard.hidden = true;
      recoveryCard.hidden = false;
      recoveryErrorMessage.hidden = true;
      recoverySuccessMessage.hidden = true;
    });
  }

  if (backToLoginBtn && loginCard && recoveryCard) {
    backToLoginBtn.addEventListener('click', () => {
      recoveryCard.hidden = true;
      loginCard.hidden = false;
    });
  }

  // Recovery Form Submit
  if (recoveryForm) {
    recoveryForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const email = document.getElementById('recoveryEmail').value;
      
      recoveryErrorMessage.hidden = true;
      recoverySuccessMessage.hidden = true;
      
      recoverySubmitBtn.disabled = true;
      recoverySubmitText.textContent = 'Enviando…';
      recoverySpinner.hidden = false;

      try {
        const response = await fetch('/api/admin/password-reset/request', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ email })
        });

        // Always show the same generic message on 200 OK
        if (response.ok) {
          recoverySuccessMessage.textContent = 'Si existe una cuenta activa asociada a ese correo, recibirás un enlace para restablecer tu contraseña.';
          recoverySuccessMessage.hidden = false;
          recoveryForm.reset();
        } else {
          const data = await response.json();
          recoveryErrorMessage.textContent = data.error || 'Error al procesar la solicitud.';
          recoveryErrorMessage.hidden = false;
        }
      } catch (err) {
        recoveryErrorMessage.textContent = 'Error de conexión. Intente nuevamente.';
        recoveryErrorMessage.hidden = false;
      } finally {
        recoverySubmitBtn.disabled = false;
        recoverySubmitText.textContent = 'Enviar enlace de recuperación';
        recoverySpinner.hidden = true;
      }
    });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const email = document.getElementById('email').value;
    const password = passwordInput.value;
    
    errorDiv.hidden = true;
    errorDiv.textContent = '';
    
    submitBtn.disabled = true;
    submitText.textContent = 'Entrando…';
    submitSpinner.hidden = false;

    try {
      const response = await fetch('/api/admin/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ email, password })
      });

      const data = await response.json();

      if (response.ok && data.ok) {
        window.location.href = '/admin/dashboard';
      } else {
        errorDiv.textContent = data.error || 'Error al iniciar sesión';
        errorDiv.hidden = false;
        
        submitBtn.disabled = false;
        submitText.textContent = 'Entrar';
        submitSpinner.hidden = true;
      }
    } catch (err) {
      errorDiv.textContent = 'Error de conexión. Intente nuevamente.';
      errorDiv.hidden = false;
      
      submitBtn.disabled = false;
      submitText.textContent = 'Entrar';
      submitSpinner.hidden = true;
    }
  });
});
