document.addEventListener('DOMContentLoaded', async () => {
  const loadingState = document.getElementById('loadingState');
  const authProtected = document.getElementById('authProtected');
  const userEmail = document.getElementById('userEmail');
  const userRole = document.getElementById('userRole');
  const logoutBtn = document.getElementById('logoutBtn');

  try {
    const res = await fetch('/api/admin/session');
    
    if (res.ok) {
      const data = await res.json();
      if (data.authenticated && data.user) {
        userEmail.textContent = data.user.email;
        userRole.textContent = data.user.role;
        
        loadingState.style.display = 'none';
        authProtected.style.display = 'block';
      } else {
        window.location.href = '/admin/';
      }
    } else {
      window.location.href = '/admin/';
    }
  } catch (err) {
    window.location.href = '/admin/';
  }

  logoutBtn.addEventListener('click', async () => {
    try {
      await fetch('/api/admin/logout', { method: 'POST' });
      window.location.href = '/admin/';
    } catch (err) {
      console.error('Logout error', err);
    }
  });
});
