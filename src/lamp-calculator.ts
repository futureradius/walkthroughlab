/**
 * The lamp calculator (lamps.html): the colour to paste into Rhino for a
 * temperature, and the intensity for a lumen or the lumen of an intensity,
 * by the same sums optimize lists lamps with (#29).
 */
import { fromHex, hexOf, hotBodyColour, toRhino } from "./hot-bodies";
import { fromRhino, kelvinOf, luminance, lumenOf, strengthFor } from "./lamps";

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const kelvin = element<HTMLInputElement>("kelvin");
const slider = element<HTMLInputElement>("kelvin-slider");
const hex = element<HTMLInputElement>("hex");
const swatch = element<HTMLSpanElement>("swatch");
const copy = element<HTMLButtonElement>("copy-hex");
const colourNote = element<HTMLParagraphElement>("colour-note");
const area = element<HTMLInputElement>("area");
const unit = element<HTMLSelectElement>("area-unit");
const lumen = element<HTMLInputElement>("lumen");
const strength = element<HTMLInputElement>("strength");
const dimNote = element<HTMLParagraphElement>("dim-note");

/** Which of lumen and intensity the author typed last: it stays, and the other follows. */
let typed: "lumen" | "strength" = "lumen";

const intensityText = (value: number) => String(Number(value.toPrecision(3)));

/** Works out everything that follows from the colour, the area and the number typed last. */
function update() {
  const picked = fromHex(hex.value);
  hex.classList.toggle("invalid", !picked);
  if (!picked) {
    colourNote.textContent = "Six hex digits, such as #FFAD55.";
    return;
  }
  swatch.style.background = hexOf(picked);
  // As Raytraced and the bake use it.
  const colour = fromRhino(picked);
  const named = kelvinOf(colour);
  colourNote.textContent =
    `Luminance ${luminance(colour).toFixed(3)}. ` +
    (named ? `Optimize lists it as ~${named} K.` : "Not a lamp colour: optimize names no temperature for it.");

  const squareMetres = Number(area.value) * Number(unit.value);
  const usable = squareMetres > 0 && luminance(colour) > 0;
  if (typed === "lumen") strength.value = usable && lumen.value ? intensityText(strengthFor(Number(lumen.value), colour, squareMetres)) : "";
  else lumen.value = usable && strength.value ? String(Math.round(lumenOf(Number(strength.value), colour, squareMetres))) : "";

  // The README keeps the intensity at 1 or above; a dimmer lamp is the same colour, darker.
  const intensity = Number(strength.value);
  dimNote.hidden = !(intensity > 0 && intensity < 1);
  if (!dimNote.hidden) {
    const darker = hexOf(toRhino(colour.map((c) => c * intensity) as unknown as typeof colour));
    dimNote.textContent = `Below 1: set the intensity to 1 and paste ${darker} instead, the same colour darker. It gives the same lumen.`;
  }
}

function setKelvin(value: number) {
  kelvin.value = slider.value = String(value);
  hex.value = hexOf(toRhino(hotBodyColour(value)));
  update();
}

kelvin.addEventListener("input", () => {
  const value = Number(kelvin.value);
  if (value >= 1700 && value <= 12000) {
    slider.value = kelvin.value;
    hex.value = hexOf(toRhino(hotBodyColour(value)));
    update();
  }
});
slider.addEventListener("input", () => setKelvin(Number(slider.value)));
hex.addEventListener("input", () => {
  update();
  const picked = fromHex(hex.value);
  const named = picked && kelvinOf(fromRhino(picked));
  if (named) kelvin.value = slider.value = String(named);
});
for (const input of [area, unit]) input.addEventListener("input", update);
lumen.addEventListener("input", () => {
  typed = "lumen";
  update();
});
strength.addEventListener("input", () => {
  typed = "strength";
  update();
});

copy.addEventListener("click", async () => {
  const picked = fromHex(hex.value);
  if (!picked) return;
  try {
    await navigator.clipboard.writeText(hexOf(picked));
    copy.textContent = "Copied";
  } catch {
    hex.select();
    copy.textContent = "Press Ctrl+C";
  }
  setTimeout(() => (copy.textContent = "Copy"), 1500);
});

area.value = "20";
unit.value = "0.0001";
lumen.value = "1200";
setKelvin(2700);
