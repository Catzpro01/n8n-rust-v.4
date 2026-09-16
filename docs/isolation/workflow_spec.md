# LEGO Specification: Workflow Pure Domain Model

## 1. Component Identity
- **LEGO ID**: workflow
- **Owner**: agent-1
- **Upstream Source**: reference/n8n/packages/workflow/src/workflow.ts
- **Interface Contract**: contracts/workflow.contract.md

## 2. Pure Data Structures (Decoupled from Node Runtime)
- WorkflowParameters: id, name, nodes, connections, active, settings, staticData, pinData.
- NodeConnectionMapping: bySource (Record<string, Record<string, IConnection[][]>>), byDestination.

## 3. Pure Functions (Mathematical and Deterministic)
1. buildConnectionMaps(connections: IConnections): NodeConnectionMapping
2. getNode(nodes: Record<string, INode>, name: string): INode | undefined
3. getParentNodes(connections: NodeConnectionMapping, nodeName: string): string[]
4. getChildNodes(connections: NodeConnectionMapping, nodeName: string): string[]
5. detectCycles(nodes: INode[], connections: NodeConnectionMapping): boolean
6. getStartNodes(nodes: INode[], connections: NodeConnectionMapping): INode[]

## 4. Decoupling Boundaries
- Expression Engine: Evaluasi ekspresi dipisahkan sepenuhnya ke LEGO expression via interface ExpressionEvaluator.
- Node Execution: Eksekusi node dipisahkan ke LEGO node via interface NodeExecutor.
- Database / Static Data: Serialisasi staticData dipisahkan ke LEGO persistence.

## 5. Golden Invariants
- Determinisme: Input graf yang sama SELALU menghasilkan adjacency list yang sama.
- Zero Side-Effects: Instansiasi Workflow tidak boleh memicu HTTP request, DB call, atau file IO.
- Non-Destructive: Validasi siklus tidak boleh mengubah urutan node asli.

## 6. Verification Plan
- Reference Smoke Test: 11/11 PASS
- Interface Contract Verification by Agent 5: VERIFIED
