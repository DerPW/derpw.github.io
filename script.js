// Lichtkegel folgt dem Mauszeiger über die Karten.
const grid = document.getElementById('projects');

grid.addEventListener('pointermove', (e) => {
  for (const card of grid.children) {
    const r = card.getBoundingClientRect();
    card.style.setProperty('--mx', `${e.clientX - r.left}px`);
    card.style.setProperty('--my', `${e.clientY - r.top}px`);
  }
});
