import { createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import { Suspense, lazy } from "react";
import { HomeRoute } from "@/routes/home";

const LazyWorldRoute = lazy(() =>
  import("@/routes/world").then((module) => ({ default: module.WorldRoute })),
);

function WorldRouteBoundary() {
  return (
    <Suspense fallback={null}>
      <LazyWorldRoute />
    </Suspense>
  );
}

function RootLayout() {
  return (
    <>
      <Outlet />
      {import.meta.env.DEV ? (
        <TanStackRouterDevtools position="bottom-right" />
      ) : null}
    </>
  );
}

const rootRoute = createRootRoute({
  component: RootLayout,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: HomeRoute,
});

const worldRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/world",
  component: WorldRouteBoundary,
});

const routeTree = rootRoute.addChildren([indexRoute, worldRoute]);

const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

export function AppRouterProvider() {
  return <RouterProvider router={router} />;
}
