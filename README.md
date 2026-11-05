# scroll-section-animator

A small pair of browser-side ES modules for building scroll-driven effects with CSS custom properties:

- **`ScrollSectionTracker`** measures sections in a scroll container and publishes section positions and progress as CSS variables.
- **`CSSProgressVariable`** builds CSS expressions that transform a progress variable into eased values or keyframed values.

The tracker keeps section measurements in sync when the page loads, resizes, or tracked elements are added, removed, or resized. The CSS helper lets you compose animations without updating each animated style on every scroll event.

## Requirements

These modules run in a browser and use ES module imports, `ResizeObserver`, `MutationObserver`, and modern CSS math functions such as `clamp()`, `sign()`, `pow()`, and trigonometric functions. Serve the files from your site or bundle them with your application.

## Quick start

Mark sections with the default `scroll-id` attribute, then create a tracker with the element that represents the scrollable page content:

```html
<main id="page-content">
  <section scroll-id="intro">...</section>
  <section scroll-id="features">...</section>
</main>

<style>
  .card {
    opacity: var(--scroll-intro-progress, 0);
    transform: translateY(
      calc((1 - var(--scroll-intro-progress, 0)) * 2rem)
    );
  }
</style>

<script type="module">
  import ScrollSectionTracker from "./scroll-section-tracker.mjs";

  const tracker = new ScrollSectionTracker({
    container: document.querySelector("#page-content")
  });

  // When the page is torn down (for example, in a single-page app):
  // tracker.destroy();
</script>
```

The tracker creates a master progress variable, `--scroll-progress`, plus variables for each section. For an element with `scroll-id="intro"`, it writes:

| Variable | Meaning |
| --- | --- |
| `--scroll-intro-start` | Section start as normalized page progress (0–1) |
| `--scroll-intro-end` | Section end as normalized page progress (0–1) |
| `--scroll-intro-top` | Section top in pixels within the container |
| `--scroll-intro-height` | Section height in pixels |
| `--scroll-intro-progress` | Progress through the section, clamped to 0–1 |
| `--scroll-intro-entered` | 0 before the section start; 1 at or after it |
| `--scroll-intro-passed` | 0 before the section end; 1 at or after it |
| `--scroll-intro-active` | 1 while master progress is in the section range; otherwise 0 |

Section variable names use the ID in the attribute, prefixed with `--scroll-`. Use unique, CSS-friendly IDs for sections.

## `ScrollSectionTracker`

`ScrollSectionTracker` discovers marked elements, measures their positions, writes their CSS variables, and exposes a small API for progress and section lookup. It watches the document for relevant DOM changes and observes section sizes, so you usually do not need to rescan manually.

### Constructor options

```js
new ScrollSectionTracker({
  container,                  // Required scroll/layout container element
  attribute: "scroll-id",    // Attribute used to mark sections
  root: document.documentElement,
  styleSheetId: null,         // Optional <style> element ID for a :root rule
  progressVariable: "--scroll-progress",
  progressSource: null        // Optional event target emitting "scroll-y"
});
```

- **`container`** is required. Section positions are measured relative to it, and the total scroll range is calculated from `container.scrollHeight - window.innerHeight`.
- **`attribute`** changes the marker attribute name if you do not want to use `scroll-id`.
- **`root`** is the element whose inline style receives the variables by default.
- **`styleSheetId`**, when provided, targets a `:root` rule in the `<style>` element with that ID. The tracker creates the style element if needed.
- **`progressVariable`** names the master progress custom property.
- **`progressSource`** can be an event target that emits a `scroll-y` event whose `event.detail.percent` is normalized from 0 to 1. If omitted, the tracker also checks for a closest `<scroll-view>` element from the container. The tracker does not derive master progress from ordinary native scroll events; call `setProgress()` or provide a compatible event source.

### Public methods

```js
tracker.setProgress(0.35); // Set master progress, clamped to [0, 1]
tracker.getProgress("intro"); // Current normalized progress for a section
tracker.get("intro"); // The section element, or null
tracker.has("intro"); // Whether the section is registered
tracker.refresh(); // Schedule section remeasurement
tracker.destroy(); // Remove listeners/observers and cancel pending measurement
```

`setProgress()` and `refresh()` return the tracker, so they can be chained. `getProgress(id)` returns `0` when the ID is unknown or its section has no measurable scroll range.

### Supplying progress yourself

If your scroll implementation does not emit the `scroll-y` event described above, update the tracker from it directly:

```js
const tracker = new ScrollSectionTracker({ container });

function onScrollProgress(percent) {
  tracker.setProgress(percent);
}
```

The value should represent overall scroll progress from `0` at the start to `1` at the end. Section measurement and CSS-variable generation are still handled by the tracker.

## `CSSProgressVariable`

`CSSProgressVariable` represents a CSS custom property containing normalized progress. It can produce an eased subrange with `slice()` or interpolate CSS-compatible values with `keyframes()`. Returned values can be used directly in CSS or passed to another helper method.

### Create and use a progress variable

```js
import CSSProgressVariable from "./css-progress-variable.mjs";

const progress = new CSSProgressVariable("--scroll-progress");

console.log(progress.value); // var(--scroll-progress)
console.log(progress.css);   // --scroll-progress: 0;
```

The constructor accepts `variable`, optional `min` and `max` (defaults `0` and `1`), and an optional `{ current }` callback. The variable name may be written with or without the leading `--`. The `css` getter returns a declaration initializing the variable to `min`; it does not insert that declaration into a stylesheet.

### Animate over part of the scroll range

`slice(inPoint, outPoint, easing)` maps the selected progress interval to 0–1 and clamps values outside the interval. Use the resulting `.value` in CSS:

```js
const progress = new CSSProgressVariable("--scroll-progress");
const intro = progress.slice(0.1, 0.4, "easeOutCubic");

const style = document.createElement("style");
style.textContent = `.hero-title {
  opacity: ${intro.value};
  transform: translateY(calc((1 - ${intro.value}) * 3rem));
}`;
document.head.append(style);
```

Available named easings are `linear`, `easeInQuad`, `easeOutQuad`, `easeInOutQuad`, `easeInCubic`, `easeOutCubic`, `easeInSine`, `easeOutSine`, and `smoothstep`. You may also pass a function that receives a CSS progress expression and returns a CSS expression.

### Interpolate keyframes

Keyframe progress positions must be between 0 and 1, with at least two frames and no duplicate positions. Values may be finite numbers or non-empty CSS values. For interpolation in the JavaScript `current` getter, CSS values must be numeric values with matching units.

```js
const progress = new CSSProgressVariable("--scroll-progress");
const colorSize = progress.keyframes([
  { progress: 0, value: "0px" },
  { progress: 0.5, value: "24px" },
  { progress: 1, value: "8px" }
]);

const style = document.createElement("style");
style.textContent = `.card {
  border-radius: ${colorSize.value};
}`;
document.head.append(style);
```

`keyframes()` accepts an optional `{ easing }` argument to ease between each adjacent pair of frames. A sliced value can also create its own keyframes:

```js
const entrance = progress.slice(0.2, 0.6, "smoothstep");
const offset = entrance.keyframes([
  { progress: 0, value: "40px" },
  { progress: 1, value: "0px" }
]);

// Use offset.value in a CSS declaration, e.g. translateY(${offset.value}).
```

Both `slice()` and `keyframes()` return an object with a `.value` CSS expression and a `.current` getter. The getter is useful when a current numeric value is available; CSS expressions remain the primary output for CSS-driven animation.

## Writing custom variables

The tracker also offers `setVariable(name, value)` and `removeVariable(name)` for variables on its configured style target. Names may be passed with or without `--`:

```js
tracker
  .setVariable("--accent-progress", "var(--scroll-intro-progress)")
  .removeVariable("accent-progress");
```

## Notes

- The tracker measures layout positions and updates on resize, load, tracked-element size changes, and relevant DOM mutations. Call `refresh()` after layout changes that are not observed automatically.
- When the container has no usable scroll distance (`scrollHeight - window.innerHeight <= 0`), measured section start and end are set to `0`.
- Call `destroy()` when a tracker is no longer needed, especially in applications that mount and unmount pages dynamically.
