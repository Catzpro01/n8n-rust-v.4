# 07 — getParentMainInputNode over ai_tool outputs

Case 03 only pinned the early-return path (stub declared `main` outputs everywhere). Here `SubTool*` node types declare `outputs: ['ai_tool']`, so the reference climbs to the node whose main input the sub-node feeds (`workflow.ts:687-744`), recursively.
