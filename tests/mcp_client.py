"""Exercise the public stdio contract from the independent Python MCP SDK."""
import asyncio
import json
import shutil
import tempfile
from pathlib import Path

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

ROOT = Path(__file__).resolve().parents[1]

async def check(file):
    params = StdioServerParameters(command="node", args=[str(ROOT/"dsm.cjs"), "mcp", str(file)])
    async with stdio_client(params) as (reader, writer), ClientSession(reader, writer) as client:
        await client.initialize()
        assert len((await client.list_tools()).tools) == 7

        async def call(name, args):
            result = await client.call_tool(name, args)
            assert not result.isError, result.content
            return json.loads(result.content[0].text)

        current = await call("dsm_read", {})
        patch = {k: current[k] for k in ("project", "base")}
        patch["ops"] = [{"op":"node","value":{"id":"F03","release":"R2"}}]
        preview = await call("dsm_preview", patch)
        assert [r["knownEffort"] for r in preview["releases"]] == [8, 10]
        patch.update(actor="MCP SDK", note="Проверка переноса")
        saved = await call("dsm_apply", patch)
        assert saved["version"] == 2
        assert (await client.call_tool("dsm_apply", patch)).isError
        diff = await call("dsm_diff", {"from":current["base"],"to":saved["base"]})
        assert diff[0]["key"] == "F03"
        assert len(await call("dsm_history", {})) == 2
        await call("dsm_restore", {"project":saved["project"],"base":saved["base"],"revision":current["base"],"actor":"SDK","note":"Возврат"})
        assert [r["knownEffort"] for r in (await call("dsm_analyze", {}))["releases"]] == [13, 5]

if __name__ == "__main__":
    with tempfile.TemporaryDirectory() as folder:
        file = Path(folder)/"project.json"
        shutil.copy(ROOT/"example/terminal-kit.dsm.json", file)
        asyncio.run(check(file))
    print("External MCP client exercised all seven tools, including stale-base rejection.")
