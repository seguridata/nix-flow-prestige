import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BpmnStudio } from "../bpmn-studio";

const instances = vi.hoisted(() => [] as {
  xml: string;
  emit: (() => void) | undefined;
  destroy: ReturnType<typeof vi.fn>;
}[]);
vi.mock("bpmn-js/lib/Modeler", () => ({default: class {
  xml = "";
  emit: (() => void) | undefined;
  destroy = vi.fn();
  constructor() { instances.push(this); }
  async importXML(xml: string) { this.xml = xml; }
  async saveXML() { return {xml: this.xml}; }
  get(service: string) {
    return service === "eventBus" ? {on: (_event: string, callback: () => void) => { this.emit = callback; }} : {zoom: vi.fn()};
  }
}}));
vi.mock("bpmn-js-token-simulation", () => ({default: {}}));

describe("BPMN draft retention", () => {
  beforeEach(() => { instances.length = 0; });
  it("retains the actual edited XML and modeler while the tab is hidden then shown", async () => {
    const onReady = vi.fn(); const onDirtyChange = vi.fn();
    const props = {xml: "<original/>", onReady, onDirtyChange};
    const view = render(<BpmnStudio {...props} visible/>);
    await waitFor(() => expect(typeof onReady.mock.calls.at(-1)?.[0]).toBe("function"));
    const instance = instances[0]!;
    await act(async () => { instance.xml = "<edited/>"; instance.emit!(); });
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    view.rerender(<BpmnStudio {...props} visible={false}/>);
    view.rerender(<BpmnStudio {...props} visible/>);
    expect(instances).toHaveLength(1);
    expect(instance.destroy).not.toHaveBeenCalled();
    await expect(onReady.mock.calls.at(-1)![0]()).resolves.toBe("<edited/>");
  });
  it("undoing back to the imported XML clears the unsaved-change guard", async () => {
    const dirty = vi.fn();
    render(<BpmnStudio xml="<original/>" visible onReady={vi.fn()} onDirtyChange={dirty}/>);
    await waitFor(() => expect(instances[0]?.emit).toBeTypeOf("function"));
    const instance = instances[0]!;
    await act(async () => { instance.xml = "<edited/>"; instance.emit!(); });
    expect(dirty).toHaveBeenLastCalledWith(true);
    await act(async () => { instance.xml = "<original/>"; instance.emit!(); });
    expect(dirty).toHaveBeenLastCalledWith(false);
  });
  it("releases the modeler and its save callback when a different saved version is loaded", async () => {
    const onReady = vi.fn(); const props = {visible: true, onReady, onDirtyChange: vi.fn()};
    const view = render(<BpmnStudio {...props} xml="<v1/>"/>);
    await waitFor(() => expect(typeof onReady.mock.calls.at(-1)?.[0]).toBe("function"));
    const first = instances[0]!;
    view.rerender(<BpmnStudio {...props} xml="<v2/>"/>);
    await waitFor(() => expect(instances).toHaveLength(2));
    await waitFor(() => expect(typeof onReady.mock.calls.at(-1)?.[0]).toBe("function"));
    expect(first.destroy).toHaveBeenCalledTimes(1);
    await expect(onReady.mock.calls.at(-1)![0]()).resolves.toBe("<v2/>");
  });
});
