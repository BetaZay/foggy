import Alpine from 'alpinejs';
import htmx from 'htmx.org';
import './app.css';

window.Alpine = Alpine;
window.htmx = htmx;
Alpine.start();

document.body.addEventListener('htmx:beforeRequest', (event) => {
  event.detail.elt.setAttribute('aria-busy', 'true');
});

document.body.addEventListener('htmx:afterRequest', (event) => {
  event.detail.elt.removeAttribute('aria-busy');
});
