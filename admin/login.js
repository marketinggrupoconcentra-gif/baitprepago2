document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('loginForm');
  const errorDiv = document.getElementById('errorMessage');
  const submitBtn = document.getElementById('submitBtn');

  // If already have session, might want to redirect, but not strictly required by UI mock.
  // We can do a quick check
  fetch('/api/admin/session')
    .then(res => res.json())
    .then(data => {
      if (data.authenticated) {
        window.location.href = '/admin/dashboard';
      }
    })
    .catch(() => {});

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    
    errorDiv.hidden = true;
    errorDiv.textContent = '';
    submitBtn.disabled = true;
    submitBtn.textContent = 'Iniciando...';

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
        submitBtn.textContent = 'Iniciar sesión';
      }
    } catch (err) {
      errorDiv.textContent = 'Error de conexión. Intente nuevamente.';
      errorDiv.hidden = false;
      submitBtn.disabled = false;
      submitBtn.textContent = 'Iniciar sesión';
    }
  });
});
