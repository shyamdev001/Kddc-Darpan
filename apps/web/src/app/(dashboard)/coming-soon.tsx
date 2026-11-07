export function ComingSoon({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{children}</p>
    </div>
  );
}
