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

  // Forgot password mock
  const recoveryMessage = document.getElementById('recoveryMessage');
  if (forgotPasswordBtn && recoveryMessage) {
    forgotPasswordBtn.addEventListener('click', () => {
      recoveryMessage.textContent = 'Solicita el restablecimiento de acceso con el administrador del sistema.';
      recoveryMessage.hidden = false;
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
