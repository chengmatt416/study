import { Link } from "react-router";
import { Compass } from "@phosphor-icons/react";
import { Empty } from "../components/ui";
import { Page } from "../layouts/Shell";

export default function NotFound() {
  return (
    <Page>
      <Empty icon={<Compass size={36} />} title="找不到這個頁面">
        <Link to="/" className="text-brand-700 underline">
          回首頁
        </Link>
      </Empty>
    </Page>
  );
}
