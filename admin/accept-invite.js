const params = new URLSearchParams(window.location.search);
const token = params.get('token');

const form = document.getElementById('acceptForm');
const passInput = document.getElementById('password');
const submitBtn = document.getElementById('submitBtn');
const submitText = document.getElementById('submitText');
const errorMsg = document.getElementById('errorMessage');
const successMsg = document.getElementById('successMessage');

if (!token) {
  errorMsg.textContent = 'Enlace de invitación inválido (falta token).';
  errorMsg.hidden = false;
  form.style.display = 'none';
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  errorMsg.hidden = true;
  submitBtn.disabled = true;
  submitText.textContent = 'Configurando...';

  try {
    const res = await fetch('/api/admin/invitations/accept', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: token,
        password: passInput.value
      })
    });
    
    const data = await res.json();
    
    if (!res.ok) {
      throw new Error(data.error || 'Ocurrió un error al aceptar la invitación');
    }

    form.style.display = 'none';
    successMsg.innerHTML = `${data.message} <br><br><a href="/admin/">Ir al login</a>`;
    successMsg.hidden = false;
  } catch (err) {
    errorMsg.textContent = err.message;
    errorMsg.hidden = false;
    submitBtn.disabled = false;
    submitText.textContent = 'Configurar cuenta';
  }
});
