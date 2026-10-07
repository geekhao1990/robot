restoreSession()
  .then(() => loadPublicSettings())
  .then(() => {
    if (!location.hash) history.replaceState({ route: 'home' }, '', '#home');
    renderLocation();
  })
  .catch((error) => {
    app.innerHTML = `<div class="notice"><strong>Web 前台初始化失败</strong>${escapeHtml(error.message)}<div class="actions"><button class="primary" data-action="retry">重试</button></div></div>`;
  });
