/*
 * Progressive enhancement for the needs board. ~2KB, no framework, no build.
 *
 * Everything here already works without it: the board is <form method="post">
 * posting to /api/claim, and the server renders the claimed and conflict
 * branches. This only removes the full page reload and runs the undo countdown.
 *
 * If this file fails to load, is blocked, or throws, the page behaves exactly
 * as it does with JavaScript disabled — which an end-to-end test asserts, so
 * that enhancement cannot quietly become dependency.
 */
;(function () {
  'use strict'

  var busy = false

  /* The reservation is the server's. This asks, waits, and shows the answer —
   * it never predicts one. Two people tapping in the same second must not both
   * see success (rule 5). */
  function submitClaim(form, event) {
    event.preventDefault()
    if (busy) return
    busy = true

    var button = form.querySelector('[data-claim-button]')
    var original = button ? button.textContent : ''
    if (button) {
      button.disabled = true
      button.setAttribute('aria-busy', 'true')
      button.textContent = 'Holding it…'
    }

    fetch(form.action, {
      method: 'POST',
      body: new FormData(form),
      headers: { accept: 'application/json' },
      credentials: 'same-origin',
    })
      .then(function (response) {
        /* Every branch reloads so the server decides what the board says —
         * and the server's own query string is what it says (UX-11). It
         * carries the outcome, the reason, and the photo's fate; rebuilding
         * it here is how a rate-limited 429 once navigated to claim=claimed
         * and drew a success panel over a refusal. */
        return response
          .json()
          .then(function (payload) {
            return payload && typeof payload.query === 'string' ? payload.query : null
          })
          .catch(function () {
            return null
          })
          .then(function (query) {
            var item = form.querySelector('[name="item"]')
            window.location.assign(
              form.getAttribute('data-return') +
                '?' +
                (query ||
                  'claim=' +
                    (response.status === 409 ? 'conflict' : 'error') +
                    '&item=' +
                    encodeURIComponent(item ? item.value : '') +
                    '&reason=conflict'),
            )
          })
      })
      .catch(function () {
        /* Offline, or the request never landed. Fall back to the thing that
         * always works rather than inventing an outcome. */
        busy = false
        if (button) {
          button.disabled = false
          button.removeAttribute('aria-busy')
          button.textContent = original
        }
        form.submit()
      })
  }

  function startCountdown(form) {
    var seconds = parseInt(form.getAttribute('data-undo-seconds'), 10)
    var button = form.querySelector('[data-undo-button]')
    if (!button || isNaN(seconds)) return

    var timer = setInterval(function () {
      seconds -= 1
      if (seconds <= 0) {
        clearInterval(timer)
        /* The server refuses after fifteen seconds regardless; this only stops
         * offering something that will not work. */
        form.parentElement.removeChild(form)
        return
      }
      button.textContent = 'Undo (' + seconds + 's)'
    }, 1000)
  }

  document.addEventListener('submit', function (event) {
    var form = event.target
    if (form && form.hasAttribute && form.hasAttribute('data-claim-form')) {
      submitClaim(form, event)
    }
  })

  /* One-tap copy on the pay screen. The value is also plain selectable text,
   * so somebody without this — or without clipboard permission — can still
   * long-press and copy it the way they always have. */
  document.addEventListener('click', function (event) {
    var button = event.target
    if (!button || !button.hasAttribute || !button.hasAttribute('data-copy-button'))
      return

    var value = button.getAttribute('data-copy-button')
    if (!navigator.clipboard) return

    navigator.clipboard.writeText(value).then(function () {
      var original = button.textContent
      button.textContent = 'Copied'
      setTimeout(function () {
        button.textContent = original
      }, 2000)
    })
  })

  var undoForms = document.querySelectorAll('[data-undo-seconds]')
  for (var i = 0; i < undoForms.length; i += 1) startCountdown(undoForms[i])

  document.documentElement.setAttribute('data-enhanced', 'needs-board')
})()
