import { notFound } from "next/navigation";
import ShowcaseClient from "./ShowcaseClient";

export default function ShowcasePage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }
  return <ShowcaseClient />;
}
