

export function PageHeader({ kicker, title, subtitle }: { kicker: string; title: string; subtitle: string }) {
  return (
    <div className="page-head window-drag-region electrobun-webkit-app-region-drag">
      <p className="caption-uppercase">{kicker}</p>
      <h1 className="display-lg">{title}</h1>
      <p className="page-sub">{subtitle}</p>
    </div>
  );
}
