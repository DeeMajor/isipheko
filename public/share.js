/*
 * Copy-the-link, and nothing else. Under 700 bytes, no framework, no build.
 *
 * The button is in the server HTML and a `<noscript>` stylesheet hides it where
 * this file cannot run — so a browser with no JavaScript sees a readonly field
 * holding the URL and no control that does nothing.
 *
 * **The listener is delegated to the document on purpose.** This is an App
 * Router page: React hydrates it after this file runs and may replace the
 * elements it hydrates. A listener bound to the button found at load time would
 * then sit on a node no longer in the document — the button would do nothing,
 * with no error anywhere. Delegation does not care which node instance exists.
 *
 * Two ways to copy, and the **older one is tried first**. `execCommand` runs
 * synchronously inside the click, so it still holds the user activation the
 * browser requires, needs no permission, and works in an old Android WebView —
 * which is a phone this product expects. `navigator.clipboard` is the fallback:
 * it needs a secure context, a permission and a focused document, and where any
 * of those is missing its promise can simply never settle. The label changes
 * only when a copy actually succeeded.
 *
 * Sending on WhatsApp and by SMS are plain links and never touch this file.
 */
;(function () {
  'use strict'

  function copyFrom(row, button) {
    var input = row.querySelector('[data-copy-source]')
    if (!input) return

    var label = button.getAttribute('data-copy-label') || button.textContent
    var copied = button.getAttribute('data-copied-label') || label

    function done() {
      button.textContent = copied
      setTimeout(function () {
        button.textContent = label
      }, 2000)
    }

    function selectAndCopy() {
      input.focus()
      input.select()
      input.setSelectionRange(0, input.value.length)

      return document.execCommand('copy')
    }

    if (selectAndCopy()) {
      done()
      return
    }

    if (navigator.clipboard) {
      navigator.clipboard.writeText(input.value).then(done, function () {
        // Refused, or the document is not focused. The URL is still in the
        // field beside the button, selected, and can be copied by hand.
      })
    }
  }

  document.addEventListener('click', function (event) {
    var target = event.target
    if (!target || !target.closest) return

    var button = target.closest('[data-copy-button]')
    if (!button) return

    var row = button.closest('[data-copy-row]')
    if (row) copyFrom(row, button)
  })
})()
