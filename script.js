const borderColors = ["#FF0000", "#FF8700", "#FFD300","#DEFF0A", "#A1FF0A", "#0AFF99", "#0AEFFF","#147DF5", "#580AFF", "#BE0AFF"];

let cards = document.getElementsByClassName("card");

for (let i = 0; i < cards.length; i++) {
  const card = cards[i];
  let color = borderColors[Math.floor(Math.random()*borderColors.length)];
  let body = card.querySelector(".card-body");
  let a = body.querySelector("a");
  let title = body.querySelector("h5");
  card.style.border = "1px solid " + color;
  a.style.backgroundColor = color;
  title.style.color = color;
}