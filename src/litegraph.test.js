describe("register node types", () => {
    let lg;
    let Sum;

    beforeEach(() => {
        jest.resetModules();
        lg = require("./litegraph");
        Sum = function Sum() {
            this.addInput("a", "number");
            this.addInput("b", "number");
            this.addOutput("sum", "number");
        };
        Sum.prototype.onExecute = function (a, b) {
            this.setOutputData(0, a + b);
        };
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test("normal case", () => {
        lg.LiteGraph.registerNodeType("math/sum", Sum);

        let node = lg.LiteGraph.registered_node_types["math/sum"];
        expect(node).toBeTruthy();
        expect(node.type).toBe("math/sum");
        expect(node.title).toBe("Sum");
        expect(node.category).toBe("math");
        expect(node.prototype.configure).toBe(
            lg.LGraphNode.prototype.configure
        );
    });

    test("callback triggers", () => {
        const consoleSpy = jest
            .spyOn(console, "log")
            .mockImplementation(() => {});

        lg.LiteGraph.onNodeTypeRegistered = jest.fn();
        lg.LiteGraph.onNodeTypeReplaced = jest.fn();
        lg.LiteGraph.registerNodeType("math/sum", Sum);
        expect(lg.LiteGraph.onNodeTypeRegistered).toHaveBeenCalled();
        expect(lg.LiteGraph.onNodeTypeReplaced).not.toHaveBeenCalled();
        lg.LiteGraph.registerNodeType("math/sum", Sum);
        expect(lg.LiteGraph.onNodeTypeReplaced).toHaveBeenCalled();
        expect(consoleSpy).toHaveBeenCalledWith(
            expect.stringMatching("replacing node type")
        );
        expect(consoleSpy).toHaveBeenCalledWith(
            expect.stringMatching("math/sum")
        );
    });

    test("node with title", () => {
        Sum.title = "The sum title";
        lg.LiteGraph.registerNodeType("math/sum", Sum);
        let node = lg.LiteGraph.registered_node_types["math/sum"];
        expect(node.title).toBe("The sum title");
        expect(node.title).not.toBe(node.name);
    });

    test("handle error simple object", () => {
        expect(() =>
            lg.LiteGraph.registerNodeType("math/sum", { simple: "type" })
        ).toThrow("Cannot register a simple object");
    });

    test("check shape mapping", () => {
        lg.LiteGraph.registerNodeType("math/sum", Sum);

        const node_type = lg.LiteGraph.registered_node_types["math/sum"];
        expect(new node_type().shape).toBe(undefined);
        node_type.prototype.shape = "default";
        expect(new node_type().shape).toBe(undefined);
        node_type.prototype.shape = "box";
        expect(new node_type().shape).toBe(lg.LiteGraph.BOX_SHAPE);
        node_type.prototype.shape = "round";
        expect(new node_type().shape).toBe(lg.LiteGraph.ROUND_SHAPE);
        node_type.prototype.shape = "circle";
        expect(new node_type().shape).toBe(lg.LiteGraph.CIRCLE_SHAPE);
        node_type.prototype.shape = "card";
        expect(new node_type().shape).toBe(lg.LiteGraph.CARD_SHAPE);
        node_type.prototype.shape = "custom_shape";
        expect(new node_type().shape).toBe("custom_shape");

        // Check that also works for replaced node types
        jest.spyOn(console, "log").mockImplementation(() => {});
        function NewCalcSum(a, b) {
            return a + b;
        }
        lg.LiteGraph.registerNodeType("math/sum", NewCalcSum);
        const new_node_type = lg.LiteGraph.registered_node_types["math/sum"];
        new_node_type.prototype.shape = "box";
        expect(new new_node_type().shape).toBe(lg.LiteGraph.BOX_SHAPE);
    });

    test("onPropertyChanged warning", () => {
        const consoleSpy = jest
            .spyOn(console, "warn")
            .mockImplementation(() => {});

        Sum.prototype.onPropertyChange = true;
        lg.LiteGraph.registerNodeType("math/sum", Sum);
        expect(consoleSpy).toBeCalledTimes(1);
        expect(consoleSpy).toBeCalledWith(
            expect.stringContaining("has onPropertyChange method")
        );
        expect(consoleSpy).toBeCalledWith(expect.stringContaining("math/sum"));
    });

    test("registering supported file extensions", () => {
        expect(lg.LiteGraph.node_types_by_file_extension).toEqual({});

        // Create two node types with calc_times overriding .pdf
        Sum.supported_extensions = ["PDF", "exe", null];
        function Times() {
            this.addInput("a", "number");
            this.addInput("b", "number");
            this.addOutput("times", "number");
        }
        Times.prototype.onExecute = function (a, b) {
            this.setOutputData(0, a * b);
        };
        Times.supported_extensions = ["pdf", "jpg"];
        lg.LiteGraph.registerNodeType("math/sum", Sum);
        lg.LiteGraph.registerNodeType("math/times", Times);

        expect(
            Object.keys(lg.LiteGraph.node_types_by_file_extension).length
        ).toBe(3);
        expect(lg.LiteGraph.node_types_by_file_extension).toHaveProperty("pdf");
        expect(lg.LiteGraph.node_types_by_file_extension).toHaveProperty("exe");
        expect(lg.LiteGraph.node_types_by_file_extension).toHaveProperty("jpg");

        expect(lg.LiteGraph.node_types_by_file_extension.exe).toBe(Sum);
        expect(lg.LiteGraph.node_types_by_file_extension.pdf).toBe(Times);
        expect(lg.LiteGraph.node_types_by_file_extension.jpg).toBe(Times);
    });

    test("register in/out slot types", () => {
        expect(lg.LiteGraph.registered_slot_in_types).toEqual({});
        expect(lg.LiteGraph.registered_slot_out_types).toEqual({});

        // Test slot type registration with first type
        lg.LiteGraph.auto_load_slot_types = true;
        lg.LiteGraph.registerNodeType("math/sum", Sum);
        expect(lg.LiteGraph.registered_slot_in_types).toEqual({
            number: { nodes: ["math/sum"] },
        });
        expect(lg.LiteGraph.registered_slot_out_types).toEqual({
            number: { nodes: ["math/sum"] },
        });

        // Test slot type registration with second type
        function ToInt() {
            this.addInput("string", "string");
            this.addOutput("number", "number");
        };
        ToInt.prototype.onExecute = function (str) {
            this.setOutputData(0, Number(str));
        };
        lg.LiteGraph.registerNodeType("basic/to_int", ToInt);
        expect(lg.LiteGraph.registered_slot_in_types).toEqual({
            number: { nodes: ["math/sum"] },
            string: { nodes: ["basic/to_int"] },
        });
        expect(lg.LiteGraph.registered_slot_out_types).toEqual({
            number: { nodes: ["math/sum", "basic/to_int"] },
        });
    });
});

describe("unregister node types", () => {
    let lg;
    let Sum;

    beforeEach(() => {
        jest.resetModules();
        lg = require("./litegraph");
        Sum = function Sum() {
            this.addInput("a", "number");
            this.addInput("b", "number");
            this.addOutput("sum", "number");
        };
        Sum.prototype.onExecute = function (a, b) {
            this.setOutputData(0, a + b);
        };
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test("remove by name", () => {
        lg.LiteGraph.registerNodeType("math/sum", Sum);
        expect(lg.LiteGraph.registered_node_types["math/sum"]).toBeTruthy();

        lg.LiteGraph.unregisterNodeType("math/sum");
        expect(lg.LiteGraph.registered_node_types["math/sum"]).toBeFalsy();
    });

    test("remove by object", () => {
        lg.LiteGraph.registerNodeType("math/sum", Sum);
        expect(lg.LiteGraph.registered_node_types["math/sum"]).toBeTruthy();

        lg.LiteGraph.unregisterNodeType(Sum);
        expect(lg.LiteGraph.registered_node_types["math/sum"]).toBeFalsy();
    });

    test("try removing with wrong name", () => {
        expect(() => lg.LiteGraph.unregisterNodeType("missing/type")).toThrow(
            "node type not found: missing/type"
        );
    });

    test("no constructor name", () => {
        function BlankNode() {}
        BlankNode.constructor = {}
        lg.LiteGraph.registerNodeType("blank/node", BlankNode);
        expect(lg.LiteGraph.registered_node_types["blank/node"]).toBeTruthy()

        lg.LiteGraph.unregisterNodeType("blank/node");
        expect(lg.LiteGraph.registered_node_types["blank/node"]).toBeFalsy();
    })
});

describe("orthogonal link routing — port-based bundling and overlap", () => {
    let lg;
    let LiteGraph;
    let LGraph;
    let LGraphCanvas;

    function makeNode(graph, x, y, num_outputs, num_inputs, type) {
        const t = type || "number";
        function TestNode() {
            for (let i = 0; i < (num_outputs || 0); i++) {
                this.addOutput("out" + i, t);
            }
            for (let i = 0; i < (num_inputs || 0); i++) {
                this.addInput("in" + i, t);
            }
        }
        const typeName = "test/node_" + (++makeNode._counter);
        LiteGraph.registerNodeType(typeName, TestNode);
        const node = LiteGraph.createNode(typeName);
        node.pos = [x, y];
        node.size = [80, Math.max(20, 20 * Math.max(num_outputs || 0, num_inputs || 0))];
        graph.add(node);
        return node;
    }
    makeNode._counter = 0;

    function makeCanvas(graph) {
        const canvas = new LGraphCanvas(null, graph, {
            skip_events: true,
            skip_render: true,
        });
        canvas.links_render_mode = LiteGraph.ORTHOGONAL_LINK;
        canvas._last_render_mode = LiteGraph.ORTHOGONAL_LINK;
        return canvas;
    }

    function pointsClose(ax, ay, bx, by, tol) {
        return Math.abs(ax - bx) < tol && Math.abs(ay - by) < tol;
    }

    function polylineCrossesNode(polyline, node) {
        const rect = Array.from(node.getBounding(new Float32Array(4), false));
        for (let i = 0; i < polyline.length - 2; i += 2) {
            if (LiteGraph.segmentCrossesRect(
                [polyline[i], polyline[i + 1]],
                [polyline[i + 2], polyline[i + 3]],
                rect
            )) {
                return true;
            }
        }
        return false;
    }

    beforeEach(() => {
        jest.resetModules();
        lg = require("./litegraph");
        LiteGraph = lg.LiteGraph;
        LGraph = lg.LGraph;
        LGraphCanvas = lg.LGraphCanvas;
        makeNode._counter = 0;
    });

    test("fan-out from one output port: three target stubs spread, origin stubs coincide", () => {
        const graph = new LGraph();
        const src = makeNode(graph, 0, 0, 1, 0);
        const tgt0 = makeNode(graph, 300, -100, 0, 1);
        const tgt1 = makeNode(graph, 300, 0, 0, 1);
        const tgt2 = makeNode(graph, 300, 100, 0, 1);
        src.connect(0, tgt0, 0);
        src.connect(0, tgt1, 0);
        src.connect(0, tgt2, 0);

        const canvas = makeCanvas(graph);
        canvas._routeOrthogonalLinks();

        const link_ids = Object.keys(graph.links).sort((a, b) => a - b);
        expect(link_ids.length).toBe(3);
        const polys = link_ids.map((id) => graph.links[id]._polyline);
        polys.forEach((p) => expect(p && p.length >= 4).toBeTruthy());

        const TOL = LiteGraph.LINK_ORTHOGONAL_OVERLAP_TOLERANCE + 1e-6;
        // first polyline point = origin slot pos — same for all three
        for (let i = 1; i < polys.length; i++) {
            expect(pointsClose(polys[0][0], polys[0][1], polys[i][0], polys[i][1], TOL)).toBe(true);
        }
        // origin stubs coincide: first segment is horizontal (y unchanged) and extends
        // at least stubLen along the slot direction. _orthoCleanPolyline may fold the
        // o_base vertex out for collinear A* runs, so we check the geometric ray rather
        // than a literal vertex match.
        const stubLen = LiteGraph.LINK_ORTHOGONAL_STUB_LENGTH;
        for (let i = 0; i < polys.length; i++) {
            // origin_offset = 0 → first segment runs along slot dir (RIGHT) at constant y
            expect(Math.abs(polys[i][3] - polys[i][1])).toBeLessThan(TOL);
            expect(polys[i][2] - polys[i][0]).toBeGreaterThanOrEqual(stubLen - TOL);
        }
        // route_origin_port_count is recorded
        link_ids.forEach((id) => {
            expect(graph.links[id]._route_origin_port_count).toBe(3);
            expect(graph.links[id]._route_target_port_count).toBe(1);
            expect(graph.links[id]._route_origin_offset).toBe(0);
        });
        // target offsets: -OFFSET, 0, +OFFSET in link.id order
        const targetOffsets = link_ids.map((id) => graph.links[id]._route_target_offset);
        const O = LiteGraph.LINK_ORTHOGONAL_PARALLEL_OFFSET;
        const sorted = targetOffsets.slice().sort((a, b) => a - b);
        expect(sorted[0]).toBeCloseTo(-O, 6);
        expect(sorted[1]).toBeCloseTo(0, 6);
        expect(sorted[2]).toBeCloseTo(O, 6);
    });

    test("fan-in to one EVENT input port: three target stubs coincide, origins spread", () => {
        const graph = new LGraph();
        const tgt = makeNode(graph, 600, 0, 0, 1, LiteGraph.ACTION);
        const src0 = makeNode(graph, 0, -100, 1, 0, LiteGraph.EVENT);
        const src1 = makeNode(graph, 0, 0, 1, 0, LiteGraph.EVENT);
        const src2 = makeNode(graph, 0, 100, 1, 0, LiteGraph.EVENT);
        src0.connect(0, tgt, 0);
        src1.connect(0, tgt, 0);
        src2.connect(0, tgt, 0);

        const canvas = makeCanvas(graph);
        canvas._routeOrthogonalLinks();

        const link_ids = Object.keys(graph.links).sort((a, b) => a - b);
        expect(link_ids.length).toBe(3);
        const polys = link_ids.map((id) => graph.links[id]._polyline);
        polys.forEach((p) => expect(p && p.length >= 4).toBeTruthy());

        const TOL = LiteGraph.LINK_ORTHOGONAL_OVERLAP_TOLERANCE + 1e-6;
        // last polyline point = target slot pos — same for all three
        for (let i = 1; i < polys.length; i++) {
            const a = polys[0], b = polys[i];
            expect(pointsClose(
                a[a.length - 2], a[a.length - 1],
                b[b.length - 2], b[b.length - 1], TOL
            )).toBe(true);
        }
        // target stubs coincide: last segment runs into the input slot along slot dir
        // (LEFT here) at constant y. _orthoCleanPolyline may collapse t_base for
        // collinear A* runs, so we verify the geometric stub ray rather than a vertex.
        const stubLen = LiteGraph.LINK_ORTHOGONAL_STUB_LENGTH;
        for (let i = 0; i < polys.length; i++) {
            const a = polys[i];
            const lastY = a[a.length - 1];
            const lastX = a[a.length - 2];
            const prevY = a[a.length - 3];
            const prevX = a[a.length - 4];
            // target_offset = 0 → last segment runs along slot dir at constant y.
            // Input slot direction is LEFT, so t_base sits to the left of the slot;
            // the last segment goes from prev (≈ t_base) right into the slot.
            expect(Math.abs(prevY - lastY)).toBeLessThan(TOL);
            expect(lastX - prevX).toBeGreaterThanOrEqual(stubLen - TOL);
        }
        link_ids.forEach((id) => {
            expect(graph.links[id]._route_target_offset).toBe(0);
        });
        const originOffsets = link_ids
            .map((id) => graph.links[id]._route_origin_offset)
            .sort((a, b) => a - b);
        const O = LiteGraph.LINK_ORTHOGONAL_PARALLEL_OFFSET;
        expect(originOffsets[0]).toBeCloseTo(-O, 6);
        expect(originOffsets[1]).toBeCloseTo(0, 6);
        expect(originOffsets[2]).toBeCloseTo(O, 6);
    });

    test("1-to-1 unique port pair: both offsets are zero", () => {
        const graph = new LGraph();
        const a = makeNode(graph, 0, 0, 1, 0);
        const b = makeNode(graph, 300, 0, 0, 1);
        a.connect(0, b, 0);

        const canvas = makeCanvas(graph);
        canvas._routeOrthogonalLinks();

        const link = graph.links[Object.keys(graph.links)[0]];
        expect(link._route_origin_offset).toBe(0);
        expect(link._route_target_offset).toBe(0);
        expect(link._route_origin_port_count).toBe(1);
        expect(link._route_target_port_count).toBe(1);
    });

    test("duplicated connection (both ports shared): both offsets zero, routes may coincide", () => {
        const graph = new LGraph();
        const src = makeNode(graph, 0, 0, 1, 0, LiteGraph.EVENT);
        const tgt = makeNode(graph, 300, 0, 0, 1, LiteGraph.ACTION);
        src.connect(0, tgt, 0);
        src.connect(0, tgt, 0);

        const canvas = makeCanvas(graph);
        canvas._routeOrthogonalLinks();

        const ids = Object.keys(graph.links);
        expect(ids.length).toBe(2);
        ids.forEach((id) => {
            expect(graph.links[id]._route_origin_offset).toBe(0);
            expect(graph.links[id]._route_target_offset).toBe(0);
        });
    });

    test("unrelated parallel links avoid the same horizontal corridor", () => {
        const graph = new LGraph();
        // two independent source→target pairs at the same y-band — the natural straight
        // route would coincide along a long horizontal corridor.
        const s0 = makeNode(graph, 0, 0, 1, 0);
        const t0 = makeNode(graph, 400, 0, 0, 1);
        const s1 = makeNode(graph, 0, 30, 1, 0);
        const t1 = makeNode(graph, 400, 30, 0, 1);
        s0.connect(0, t0, 0);
        s1.connect(0, t1, 0);

        const canvas = makeCanvas(graph);
        canvas._routeOrthogonalLinks();

        const ids = Object.keys(graph.links).sort((a, b) => a - b);
        const p0 = graph.links[ids[0]]._polyline;
        const p1 = graph.links[ids[1]]._polyline;

        // Sum up collinear-overlap length between any segment of p0 and any of p1.
        const tol = LiteGraph.LINK_ORTHOGONAL_OVERLAP_TOLERANCE;
        let overlap = 0;
        for (let i = 0; i < p0.length - 2; i += 2) {
            for (let j = 0; j < p1.length - 2; j += 2) {
                const ax1 = p0[i], ay1 = p0[i + 1], ax2 = p0[i + 2], ay2 = p0[i + 3];
                const bx1 = p1[j], by1 = p1[j + 1], bx2 = p1[j + 2], by2 = p1[j + 3];
                const aHoriz = ay1 === ay2;
                const bHoriz = by1 === by2;
                if (aHoriz && bHoriz && Math.abs(ay1 - by1) < tol) {
                    const lo = Math.max(Math.min(ax1, ax2), Math.min(bx1, bx2));
                    const hi = Math.min(Math.max(ax1, ax2), Math.max(bx1, bx2));
                    if (hi > lo) overlap += hi - lo;
                } else if (!aHoriz && !bHoriz && Math.abs(ax1 - bx1) < tol) {
                    const lo = Math.max(Math.min(ay1, ay2), Math.min(by1, by2));
                    const hi = Math.min(Math.max(ay1, ay2), Math.max(by1, by2));
                    if (hi > lo) overlap += hi - lo;
                }
            }
        }
        expect(overlap).toBe(0);
    });

    test("with LINK_ORTHOGONAL_OVERLAP_COST = 0 unrelated links may coincide", () => {
        // sanity: the penalty constant is the only thing forcing separation.
        const saved = LiteGraph.LINK_ORTHOGONAL_OVERLAP_COST;
        LiteGraph.LINK_ORTHOGONAL_OVERLAP_COST = 0;
        try {
            const graph = new LGraph();
            const s0 = makeNode(graph, 0, 0, 1, 0);
            const t0 = makeNode(graph, 400, 0, 0, 1);
            const s1 = makeNode(graph, 0, 0, 1, 0);
            const t1 = makeNode(graph, 400, 0, 0, 1);
            // place the second pair colinear with the first
            s1.pos = [0, 0];
            t1.pos = [400, 0];
            s0.connect(0, t0, 0);
            s1.connect(0, t1, 0);

            const canvas = makeCanvas(graph);
            canvas._routeOrthogonalLinks();

            // we just verify the router didn't crash and produced two polylines —
            // with the penalty disabled there is no constraint requiring separation.
            const ids = Object.keys(graph.links);
            expect(ids.length).toBe(2);
            ids.forEach((id) => {
                expect(graph.links[id]._polyline).toBeTruthy();
                expect(graph.links[id]._polyline.length).toBeGreaterThanOrEqual(4);
            });
        } finally {
            LiteGraph.LINK_ORTHOGONAL_OVERLAP_COST = saved;
        }
    });

    test("a proper crossing contributes only crossing cost, not overlap", () => {
        // Two unrelated links, geometrically arranged so the natural orthogonal routes
        // proper-cross at a single point but share zero collinear length.
        const tol = LiteGraph.LINK_ORTHOGONAL_OVERLAP_TOLERANCE;
        const graph = new LGraph();
        // s0 → t0: horizontal route at y ≈ 0 from x=0 to x=400
        const s0 = makeNode(graph, 0, 0, 1, 0);
        const t0 = makeNode(graph, 400, 0, 0, 1);
        // s1 → t1: vertical route through x ≈ 200 (top to bottom)
        // crosses s0→t0 at one point, doesn't share a collinear corridor.
        const s1 = makeNode(graph, 200, -300, 1, 0);
        const t1 = makeNode(graph, 200, 300, 0, 1);
        s0.connect(0, t0, 0);
        s1.connect(0, t1, 0);
        const canvas = makeCanvas(graph);
        canvas._routeOrthogonalLinks();

        const ids = Object.keys(graph.links);
        expect(ids.length).toBe(2);
        const p0 = graph.links[ids[0]]._polyline;
        const p1 = graph.links[ids[1]]._polyline;
        // count collinear overlap between the two — should remain zero even though they cross.
        let overlap = 0;
        for (let i = 0; i < p0.length - 2; i += 2) {
            for (let j = 0; j < p1.length - 2; j += 2) {
                const ax1 = p0[i], ay1 = p0[i + 1], ax2 = p0[i + 2], ay2 = p0[i + 3];
                const bx1 = p1[j], by1 = p1[j + 1], bx2 = p1[j + 2], by2 = p1[j + 3];
                const aHoriz = ay1 === ay2;
                const bHoriz = by1 === by2;
                if (aHoriz && bHoriz && Math.abs(ay1 - by1) < tol) {
                    const lo = Math.max(Math.min(ax1, ax2), Math.min(bx1, bx2));
                    const hi = Math.min(Math.max(ax1, ax2), Math.max(bx1, bx2));
                    if (hi > lo) overlap += hi - lo;
                } else if (!aHoriz && !bHoriz && Math.abs(ax1 - bx1) < tol) {
                    const lo = Math.max(Math.min(ay1, ay2), Math.min(by1, by2));
                    const hi = Math.min(Math.max(ay1, ay2), Math.max(by1, by2));
                    if (hi > lo) overlap += hi - lo;
                }
            }
        }
        expect(overlap).toBe(0);
    });

    test("port-related (fan-out) links may coincide despite shared corridor", () => {
        const graph = new LGraph();
        const src = makeNode(graph, 0, 0, 1, 0);
        const t0 = makeNode(graph, 400, -50, 0, 1);
        const t1 = makeNode(graph, 400, 50, 0, 1);
        src.connect(0, t0, 0);
        src.connect(0, t1, 0);

        const canvas = makeCanvas(graph);
        canvas._routeOrthogonalLinks();

        // origin stubs (first two polyline points) coincide because origin_offset=0 for
        // both, despite being unrelated to other-corridor links — bundling at the
        // shared output is permitted by design.
        const ids = Object.keys(graph.links).sort((a, b) => a - b);
        const p0 = graph.links[ids[0]]._polyline;
        const p1 = graph.links[ids[1]]._polyline;
        expect(p0[0]).toBe(p1[0]);
        expect(p0[1]).toBe(p1[1]);
        expect(p0[2]).toBe(p1[2]);
        expect(p0[3]).toBe(p1[3]);
    });

    test("stationary graph reuses the route cache (frame stable)", () => {
        const graph = new LGraph();
        const a = makeNode(graph, 0, 0, 1, 0);
        const b = makeNode(graph, 300, 0, 0, 1);
        a.connect(0, b, 0);

        const canvas = makeCanvas(graph);
        canvas._routeOrthogonalLinks();
        const link = graph.links[Object.keys(graph.links)[0]];
        const firstPoly = link._polyline;

        for (let i = 0; i < 10; i++) {
            canvas._routeOrthogonalLinks();
            // Cache hit returns the same Float32Array instance.
            expect(link._polyline).toBe(firstPoly);
        }
    });

    test("moving an unrelated obstacle node re-routes cached orthogonal links", () => {
        const graph = new LGraph();
        const a = makeNode(graph, 0, 0, 1, 0);
        const b = makeNode(graph, 400, 0, 0, 1);
        const c = makeNode(graph, 190, 90, 0, 0);
        a.connect(0, b, 0);

        const canvas = makeCanvas(graph);
        canvas._routeOrthogonalLinks();
        const link = graph.links[Object.keys(graph.links)[0]];
        const before = link._polyline;
        expect(polylineCrossesNode(before, c)).toBe(false);

        c.pos = [190, 0];
        c.setDirtyCanvas(true, true);
        canvas._routeOrthogonalLinks();

        expect(link._polyline).not.toBe(before);
        expect(polylineCrossesNode(link._polyline, c)).toBe(false);
    });

    test("moving a group re-routes links around nodes carried by the group", () => {
        const graph = new LGraph();
        const a = makeNode(graph, 0, 0, 1, 0);
        const b = makeNode(graph, 400, 0, 0, 1);
        const c = makeNode(graph, 190, 90, 0, 0);
        const group = new LiteGraph.LGraphGroup("group");
        graph.add(group);
        group._nodes = [c];
        a.connect(0, b, 0);

        const canvas = makeCanvas(graph);
        canvas._routeOrthogonalLinks();
        const link = graph.links[Object.keys(graph.links)[0]];
        const before = link._polyline;
        expect(polylineCrossesNode(before, c)).toBe(false);

        group.move(0, -90);
        canvas.setDirty(true, true);
        canvas._routeOrthogonalLinks();

        expect(link._polyline).not.toBe(before);
        expect(polylineCrossesNode(link._polyline, c)).toBe(false);
    });

    test("adding a sibling link invalidates the port group cache", () => {
        const graph = new LGraph();
        const src = makeNode(graph, 0, 0, 1, 0);
        const t0 = makeNode(graph, 300, -50, 0, 1);
        src.connect(0, t0, 0);

        const canvas = makeCanvas(graph);
        canvas._routeOrthogonalLinks();
        const v1 = canvas._route_version;
        const link0 = graph.links[Object.keys(graph.links)[0]];
        const polyBefore = link0._polyline;
        expect(link0._route_origin_port_count).toBe(1);

        const t1 = makeNode(graph, 300, 50, 0, 1);
        src.connect(0, t1, 0);

        // _route_version bumped by node-add + link-add
        expect(canvas._route_version).toBeGreaterThan(v1);

        canvas._routeOrthogonalLinks();
        // both links now carry the updated port count
        const ids = Object.keys(graph.links);
        ids.forEach((id) => {
            expect(graph.links[id]._route_origin_port_count).toBe(2);
        });
        // and the original link's polyline was recomputed (different instance)
        expect(link0._polyline).not.toBe(polyBefore);
    });

    test("removing a sibling re-routes remaining links with the smaller-group offset", () => {
        const graph = new LGraph();
        const src = makeNode(graph, 0, 0, 1, 0);
        const t0 = makeNode(graph, 300, -100, 0, 1);
        const t1 = makeNode(graph, 300, 0, 0, 1);
        const t2 = makeNode(graph, 300, 100, 0, 1);
        src.connect(0, t0, 0);
        src.connect(0, t1, 0);
        src.connect(0, t2, 0);

        const canvas = makeCanvas(graph);
        canvas._routeOrthogonalLinks();
        // disconnect the middle link
        src.disconnectOutput(0, t1);
        canvas._routeOrthogonalLinks();

        const remaining = Object.keys(graph.links).map((id) => graph.links[id]);
        expect(remaining.length).toBe(2);
        remaining.forEach((l) => expect(l._route_origin_port_count).toBe(2));
        const O = LiteGraph.LINK_ORTHOGONAL_PARALLEL_OFFSET;
        const offsets = remaining.map((l) => l._route_target_offset).sort((a, b) => a - b);
        expect(offsets[0]).toBeCloseTo(-O / 2, 6);
        expect(offsets[1]).toBeCloseTo(O / 2, 6);
    });
});
