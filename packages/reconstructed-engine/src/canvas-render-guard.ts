// Canvas SVG Render Guard & Infinite Mutation Loop Neutralizer
export class CanvasRenderGuard {
  private static readonly SAFE_ELEMENTS = new WeakSet<Node>();

  public static isSafeFromMutationLoop(target: Node): boolean {
    if (this.SAFE_ELEMENTS.has(target)) return true;
    this.SAFE_ELEMENTS.add(target);
    return false;
  }
}
