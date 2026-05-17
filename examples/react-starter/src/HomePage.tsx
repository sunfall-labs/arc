import { Button as BaseButton } from "@base-ui/react/button";
import { useResource } from "@effect-ui/react";
import { Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge.js";
import { Button } from "@/components/ui/button.js";
import { WelcomeRef } from "./starter.js";

export function HomePage() {
  const welcome = useResource(WelcomeRef);

  return (
    <main className="min-h-svh bg-background">
      <section className="mx-auto flex min-h-svh w-full max-w-5xl items-center px-6 py-10">
        <div className="grid gap-6">
          <div className="inline-flex w-fit items-center gap-2 rounded-md border border-border bg-card px-3 py-1 text-sm text-muted-foreground">
            <Sparkles className="size-4" aria-hidden="true" />
            Effect UI React Starter
            <Badge variant="secondary">shadcn CLI</Badge>
          </div>
          {welcome.match({
            initial: () => (
              <h1 className="text-4xl font-semibold tracking-normal">Loading starter resource</h1>
            ),
            pending: () => (
              <h1 className="text-4xl font-semibold tracking-normal">Loading starter resource</h1>
            ),
            success: (value) => (
              <>
                <h1 className="max-w-3xl text-4xl font-semibold tracking-normal text-foreground sm:text-5xl">
                  {value.message}
                </h1>
                <p className="max-w-2xl text-base leading-7 text-muted-foreground">
                  React adapter, route-owned Resource preload, SSR hydration, Tailwind v4, and a
                  shadcn-compatible component layout are wired together in one small starter.
                </p>
                <div className="flex flex-wrap gap-3">
                  <Button>React adapter ready</Button>
                  <Button variant="outline">Add shadcn components</Button>
                  <BaseButton className="inline-flex h-9 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md border border-input bg-background px-4 py-2 text-sm font-medium shadow-xs transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50">
                    Base UI primitive
                  </BaseButton>
                </div>
              </>
            ),
            failure: () => (
              <h1 className="text-4xl font-semibold tracking-normal">Starter resource failed</h1>
            ),
          })}
        </div>
      </section>
    </main>
  );
}
