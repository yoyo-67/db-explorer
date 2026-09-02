import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRouteWithContext,
} from '@tanstack/react-router'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { TanStackDevtools } from '@tanstack/react-devtools'
import Header from '../components/Header'
import { useServerSettingsSync } from '#/hooks/useServerSettings'
import Sidebar from '../components/Sidebar'
import TextScaleSync from '../components/TextScaleSync'
import ThemeSync from '../components/ThemeSync'

import TanStackQueryDevtools from '../integrations/tanstack-query/devtools'

import appCss from '../styles.css?url'

import { parseServerFace } from '#/lib/server-face'
import type { ServerFace } from '#/lib/server-face'
import type { QueryClient } from '@tanstack/react-query'

interface MyRouterContext {
  queryClient: QueryClient
}

const TEXT_SCALE_INIT_SCRIPT = `(function(){try{var raw=Number(window.localStorage.getItem('textScale'));var steps=[0.9,1,1.1,1.25,1.4,1.6];var scale=steps.indexOf(raw)===-1?1:raw;if(scale!==1){document.documentElement.style.zoom=String(scale)}}catch(e){}})();`

const THEME_INIT_SCRIPT = `(function(){try{var stored=window.localStorage.getItem('theme');var mode=(stored==='light'||stored==='dark'||stored==='auto')?stored:'auto';var prefersDark=window.matchMedia('(prefers-color-scheme: dark)').matches;var resolved=mode==='auto'?(prefersDark?'dark':'light'):mode;var root=document.documentElement;root.classList.remove('light','dark');root.classList.add(resolved);if(mode==='auto'){root.removeAttribute('data-theme')}else{root.setAttribute('data-theme',mode)}root.style.colorScheme=resolved;}catch(e){}})();`

export const Route = createRootRouteWithContext<MyRouterContext>()({
  /**
   * The server panel is open state that belongs in the URL — it is a view of
   * the database, and a view worth sending to somebody.
   *
   * Declared on the root because the panel opens from the header, over whatever
   * page is showing. A child route's `validateSearch` only owns the keys it
   * returns; the router merges the matched routes' results, so a key declared
   * here survives every page.
   */
  validateSearch: (search: Record<string, unknown>): { server?: ServerFace } => {
    const face = parseServerFace(search.server)
    // The key is omitted rather than set to undefined: a required-but-undefined
    // search key would force every `navigate` in the app to mention it.
    return face ? { server: face } : {}
  },
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      {
        title: 'DB Explorer',
      },
    ],
    links: [
      {
        rel: 'stylesheet',
        href: appCss,
      },
    ],
  }),
  component: RootComponent,
  shellComponent: RootDocument,
})

function RootComponent() {
  // Query logging and the statement timeout are enforced server-side; this is
  // where this browser's choice of both gets there.
  useServerSettingsSync()
  return <Outlet />
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: TEXT_SCALE_INIT_SCRIPT }} />
        <HeadContent />
      </head>
      <body className="font-sans antialiased [overflow-wrap:anywhere] selection:bg-[rgba(79,184,178,0.24)]">
        {/* Before anything visible: hydration reconciles `<html>` and drops the
            class the head script set, so the palette needs an owner that
            outlives it. */}
        <ThemeSync />
        <TextScaleSync />
        <Header />
        <div className="flex">
          <Sidebar />
          <div className="min-w-0 flex-1">{children}</div>
        </div>
        <TanStackDevtools
          config={{
            position: 'bottom-right',
          }}
          plugins={[
            {
              name: 'Tanstack Router',
              render: <TanStackRouterDevtoolsPanel />,
            },
            TanStackQueryDevtools,
          ]}
        />
        <Scripts />
      </body>
    </html>
  )
}
