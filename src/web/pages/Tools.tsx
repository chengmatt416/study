import { useNavigate, useParams } from "react-router";
import { ToolPanel, TOOLS, type ToolId } from "../features/tools/ToolPanel";

export default function Tools() {
  const { tool } = useParams();
  const navigate = useNavigate();
  const initial = (TOOLS.some((t) => t.id === tool) ? tool : "graphing") as ToolId;
  return (
    <div className="h-full">
      <ToolPanel initial={initial} onToolChange={(t) => navigate(`/tools/${t}`, { replace: true })} />
    </div>
  );
}
