const sdk = window.PipefyApp;

if (sdk) {
  // `render` avisa a Pipefy que a página carregou. Sem ele, o usuário volta
  // para o Kanban. Não usar `p.render()`: está quebrado segundo a documentação.
  sdk.render(() => {
    const app = document.getElementById('app');
    if (app) app.textContent = 'Dashboard em construção.';
  });
}
