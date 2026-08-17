import { parseRequestCookies, parseSetCookie } from 'hakka-core'
import type { ParsedCookie } from 'hakka-core'
import type { Component } from 'solid-js'
import { createMemo, For, Show } from 'solid-js'

interface CookieRowProps {
  cookie: ParsedCookie
}

const CookieRow: Component<CookieRowProps> = (props) => {
  const attrs = createMemo(() => {
    const c = props.cookie
    const list: string[] = []
    if (c.domain) list.push(`Domain=${c.domain}`)
    if (c.path) list.push(`Path=${c.path}`)
    if (c.expires) list.push(`Expires=${c.expires}`)
    if (c.maxAge != null) list.push(`Max-Age=${c.maxAge}`)
    if (c.httpOnly) list.push('HttpOnly')
    if (c.secure) list.push('Secure')
    if (c.sameSite) list.push(`SameSite=${c.sameSite}`)
    return list
  })

  return (
    <tr>
      <td class="hakka-kv-key">{props.cookie.name}</td>
      <td class="hakka-kv-value">
        <div>{props.cookie.value || <em style="color:var(--hakka-text-tertiary)">(empty)</em>}</div>
        <Show when={attrs().length > 0}>
          <div style="font-size:var(--hakka-font-xs);color:var(--hakka-text-tertiary);margin-top: var(--hakka-space-xxs)">
            {attrs().join(' · ')}
          </div>
        </Show>
      </td>
    </tr>
  )
}

interface DetailCookiesTabProps {
  requestCookieHeader: string | undefined
  responseCookieHeaders: string | string[] | undefined
}

export const DetailCookiesTab: Component<DetailCookiesTabProps> = (props) => {
  const requestCookies = createMemo(() => parseRequestCookies(props.requestCookieHeader))
  const responseCookies = createMemo(() => parseSetCookie(props.responseCookieHeaders))
  const hasCookies = () => requestCookies().length > 0 || responseCookies().length > 0

  return (
    <Show
      when={hasCookies()}
      fallback={
        <div class="hakka-list-empty">
          <span class="hakka-empty-title">No cookies</span>
        </div>
      }
    >
      <Show when={requestCookies().length > 0}>
        <p class="hakka-section-title">Request Cookies</p>
        <table class="hakka-kv-table">
          <tbody>
            <For each={requestCookies()}>
              {(c) => (
                <tr>
                  <td class="hakka-kv-key">{c.name}</td>
                  <td class="hakka-kv-value">{c.value || <em style="color:var(--hakka-text-tertiary)">(empty)</em>}</td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </Show>
      <Show when={responseCookies().length > 0}>
        <p class="hakka-section-title">Response Cookies (Set-Cookie)</p>
        <table class="hakka-kv-table">
          <tbody>
            <For each={responseCookies()}>{(c) => <CookieRow cookie={c} />}</For>
          </tbody>
        </table>
      </Show>
    </Show>
  )
}
