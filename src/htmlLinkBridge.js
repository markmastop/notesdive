function click(event) {
  const anchor = event.target.closest && event.target.closest('a[href]');
  if (!anchor) return;
  event.preventDefault();
  parent.postMessage({ type: 'notesdive-html-link', href: anchor.getAttribute('href') }, '*');
}
document.addEventListener('click', click, true);
document.addEventListener('auxclick', click, true);
window.addEventListener('message', function(event) {
  if (event.source !== parent || !event.data || event.data.type !== 'notesdive-html-scroll' || typeof event.data.id !== 'string') return;
  const id = event.data.id;
  if (!id) { window.scrollTo(0, 0); return; }
  const target = document.getElementById(id) || document.getElementsByName(id)[0];
  if (target) target.scrollIntoView();
});
