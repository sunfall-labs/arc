import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { formatPrice, statusLabel } from "../../../shared/model";
import { itemQuery } from "../items";

export const Route = createFileRoute("/items/$id")({
  loader: async ({ context, params }) => {
    const item = await context.queryClient.query({ ...itemQuery(params.id), staleTime: "static" });
    if (item === null) {
      throw notFound();
    }
  },
  component: DetailPage,
  notFoundComponent: NotFound,
});

function DetailPage() {
  const { id } = Route.useParams();
  const { data: item } = useSuspenseQuery(itemQuery(id));
  if (item === null) {
    return <NotFound />;
  }
  return (
    <article className="detail" data-testid="detail" data-id={item.id}>
      <h1>{item.name}</h1>
      <dl>
        <dt>Category</dt>
        <dd>{item.category}</dd>
        <dt>Price</dt>
        <dd>{formatPrice(item.price)}</dd>
        <dt>Status</dt>
        <dd data-testid="status">{statusLabel(item.done)}</dd>
      </dl>
      <Link className="back" to="/" data-testid="back">
        Back to items
      </Link>
    </article>
  );
}

function NotFound() {
  const { id } = Route.useParams();
  return (
    <section className="not-found" data-testid="not-found">
      <h1>Item not found</h1>
      <p>No item with id {id}.</p>
      <Link className="back" to="/" data-testid="back">
        Back to items
      </Link>
    </section>
  );
}
