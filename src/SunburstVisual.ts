/*
 *  Power BI Visualizations
 *
 *  Copyright (c) Microsoft Corporation
 *  All rights reserved.
 *  MIT License
 *
 *  Permission is hereby granted, free of charge, to any person obtaining a copy
 *  of this software and associated documentation files (the ""Software""), to deal
 *  in the Software without restriction, including without limitation the rights
 *  to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 *  copies of the Software, and to permit persons to whom the Software is
 *  furnished to do so, subject to the following conditions:
 *
 *  The above copyright notice and this permission notice shall be included in
 *  all copies or substantial portions of the Software.
 *
 *  THE SOFTWARE IS PROVIDED *AS IS*, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 *  IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 *  FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 *  AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 *  LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 *  OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 *  THE SOFTWARE.
 */
module powerbi.extensibility.visual {
    // powerbi.extensibility
    import IVisual = powerbi.extensibility.IVisual;
    import IColorPalette = powerbi.extensibility.IColorPalette;
    import ISelectionManager = powerbi.extensibility.ISelectionManager;

    // powerbi.visuals
    import ISelectionId = powerbi.visuals.ISelectionId;

    // powerbi.extensibility.utils.color
    import ColorHelper = powerbi.extensibility.utils.color.ColorHelper;

    // powerbi.extensibility.utils.type
    import PixelConverter = powerbi.extensibility.utils.type.PixelConverter;

    // powerbi.extensibility.utils.tooltip
    import TooltipEventArgs = powerbi.extensibility.utils.tooltip.TooltipEventArgs;
    import ITooltipServiceWrapper = powerbi.extensibility.utils.tooltip.ITooltipServiceWrapper;
    import TooltipEnabledDataPoint = powerbi.extensibility.utils.tooltip.TooltipEnabledDataPoint;
    import createTooltipServiceWrapper = powerbi.extensibility.utils.tooltip.createTooltipServiceWrapper;

    // powerbi.extensibility.utils.svg
    import translate = powerbi.extensibility.utils.svg.translate;
    import CssConstants = powerbi.extensibility.utils.svg.CssConstants;
    import ClassAndSelector = powerbi.extensibility.utils.svg.CssConstants.ClassAndSelector;
    import createClassAndSelector = powerbi.extensibility.utils.svg.CssConstants.createClassAndSelector;

    // powerbi.extensibility.utils.formatting
    import valueFormatter = powerbi.extensibility.utils.formatting.valueFormatter;
    import IValueFormatter = powerbi.extensibility.utils.formatting.IValueFormatter;

    // powerbi.extensibility.utils.chart.legend
    import createLegend = powerbi.extensibility.utils.chart.legend.createLegend;
    import ILegend = powerbi.extensibility.utils.chart.legend.ILegend;
    import Legend = powerbi.extensibility.utils.chart.legend;
    import LegendData = powerbi.extensibility.utils.chart.legend.LegendData;
    import LegendIcon = powerbi.extensibility.utils.chart.legend.LegendIcon;
    import LegendPosition = powerbi.extensibility.utils.chart.legend.LegendPosition;

    interface IAppCssConstants {
        main: ClassAndSelector;
        mainInteractive: ClassAndSelector;
        slice: ClassAndSelector;
        sliceSelected: ClassAndSelector;
        sliceHidden: ClassAndSelector;
        label: ClassAndSelector;
        labelVisible: ClassAndSelector;
        categoryLabel: ClassAndSelector;
        percentageLabel: ClassAndSelector;
        sliceLabel: ClassAndSelector;
    }

    export class Sunburst implements IVisual {
        private static ViewBoxSize: number = 500;
        private static CentralPoint: number = Sunburst.ViewBoxSize / 2;
        private static OuterRadius: number = Sunburst.ViewBoxSize / 2;
        private static PercentageFontSizeMultiplier: number = 2;
        private static CategoryLineInterval: number = 0.6;
        private static DefaultPercentageLineInterval: number = 0.25;
        private static MultilinePercentageLineInterval: number = 0.6;

        private static ChangeDataType: number = 2;
        private static ChangeAllType: number = 62;

        private static DefaultDataLabelPadding: number = 5;

        private _labelsHidden: boolean = true;

        private static LegendPropertyIdentifier: DataViewObjectPropertyIdentifier = {
            objectName: "group",
            propertyName: "fill"
        };
        private set labelsHidden(hidden: boolean) {
            this._labelsHidden = hidden;
            this.percentageLabel.classed(this.appCssConstants.labelVisible.className, !hidden);
            this.selectedCategoryLabel.classed(this.appCssConstants.labelVisible.className, !hidden && this.settings.group.showSelected);
        }
        private _settings: SunburstSettings;
        private get settings(): SunburstSettings {
            return this._settings;
        }
        private set settings(settings: SunburstSettings) {
            this._settings = settings;
            if (!this._settings
                || this.settings.group.fontSize !== settings.group.fontSize
                || this.settings.group.showSelected !== settings.group.showSelected) {
                if (this.labelsHidden) {
                    return;
                }
                this.svg.style(CssConstants.fontSizeProperty, PixelConverter.toString(settings.group.fontSize));
                this.selectedCategoryLabel.classed(this.appCssConstants.labelVisible.className, this.settings.group.showSelected);
                this.calculateLabelPosition();
            }
        }
        private visualHost: IVisualHost;
        private rawData: DataViewMatrix;
        private data: SunburstData;
        private arc: d3.svg.Arc<SunburstSlice>;
        private chartWrapper: d3.Selection<{}>;
        private svg: d3.Selection<{}>;
        private main: d3.Selection<{}>;
        private percentageLabel: d3.Selection<string>;
        private percentageFormatter: IValueFormatter;
        private selectedCategoryLabel: d3.Selection<string>;

        private appCssConstants: IAppCssConstants = {
            main: createClassAndSelector("sunburst"),
            mainInteractive: createClassAndSelector("sunburst--interactive"),
            slice: createClassAndSelector("sunburst__slice"),
            sliceSelected: createClassAndSelector("sunburst__slice--selected"),
            sliceHidden: createClassAndSelector("sunburst__slice--hidden"),
            label: createClassAndSelector("sunburst__label"),
            labelVisible: createClassAndSelector("sunburst__label--visible"),
            categoryLabel: createClassAndSelector("sunburst__category-label"),
            percentageLabel: createClassAndSelector("sunburst__percentage-label"),
            sliceLabel: createClassAndSelector("sunburst__slice-label")
        };
        private colors: IColorPalette;
        private selectionManager: ISelectionManager;
        private tooltipService: ITooltipServiceWrapper;
        private viewport: IViewport;
        private legend: ILegend;
        private legendData: LegendData;
        constructor(options: VisualConstructorOptions) {
            this.visualHost = options.host;
            this.tooltipService = createTooltipServiceWrapper(
                options.host.tooltipService,
                options.element);
            this.percentageFormatter = valueFormatter.create({ format: "0.00%;-0.00%;0.00%" });

            this.arc = d3.svg.arc<SunburstSlice>()
                .startAngle((slice: SunburstSlice) => slice.x)
                .endAngle((slice: SunburstSlice) => slice.x + slice.dx)
                .innerRadius((slice: SunburstSlice) => Math.sqrt(slice.y))
                .outerRadius((slice: SunburstSlice) => Math.sqrt(slice.y + slice.dy));

            this.colors = options.host.colorPalette;
            this.selectionManager = options.host.createSelectionManager();
            this.chartWrapper = d3.select(options.element)
                .append("div")
                .classed(this.appCssConstants.main.className, true);

            this.svg = this.chartWrapper
                .append("svg")
                .attr("viewBox", `0 0 ${Sunburst.ViewBoxSize} ${Sunburst.ViewBoxSize}`)
                .attr("width", "100%")
                .attr("height", "100%")
                .attr("preserveAspectRatio", "xMidYMid meet");

            this.main = this.svg.append("g");
            this.main.attr(CssConstants.transformProperty, translate(Sunburst.CentralPoint, Sunburst.CentralPoint));

            this.selectedCategoryLabel = <d3.Selection<string>>this.svg
                .append("text")
                .classed(this.appCssConstants.label.className, true)
                .classed(this.appCssConstants.categoryLabel.className, true);
            this.selectedCategoryLabel.attr("x", Sunburst.CentralPoint);
            this.selectedCategoryLabel.attr("y", Sunburst.CentralPoint);

            this.percentageLabel = <d3.Selection<string>>this.svg
                .append("text")
                .classed(this.appCssConstants.label.className, true)
                .classed(this.appCssConstants.percentageLabel.className, true);
            this.percentageLabel.attr("x", Sunburst.CentralPoint);
            this.percentageLabel.attr("y", Sunburst.CentralPoint);

            this.svg.on("click", () => {
                this.svg
                    .classed(this.appCssConstants.mainInteractive.className, false);
                this.labelsHidden = true;
                this.selectionManager.clear();
            });
            // create legend container
            this.legend = createLegend(options.element,
                false,
                null,
                true,
                LegendPosition.Top);
        }

        public update(options: VisualUpdateOptions): void {
            if (!options
                || !options.dataViews
                || !options.dataViews[0]
                || !options.dataViews[0].matrix
                || !options.dataViews[0].matrix.rows
                || !options.dataViews[0].matrix.rows.root
                || !options.dataViews[0].matrix.rows.root.children
                || !options.dataViews[0].matrix.rows.root.children.length
                || !options.dataViews[0].matrix.columns
                || !options.dataViews[0].matrix.columns.root
                || !options.dataViews[0].matrix.columns.root.children
                || !options.dataViews[0].matrix.columns.root.children.length) {
                this.clear();

                return;
            }
            this.viewport = options.viewport;
            this.settings = this.parseSettings(options.dataViews[0]);
            this.rawData = options.dataViews[0].matrix;
            this.data = this.convert(options.dataViews[0], this.colors, this.visualHost);
            this.updateInternal();

            if (this.data) {
                this.legendData = Sunburst.createLegend(this.data, this.settings);
                this.renderLegend();
            }
            if (this.settings.legend.show) {
                this.chartWrapper.style({
                    width: PixelConverter.toString(this.viewport.width),
                    height: PixelConverter.toString(this.viewport.height)
                });
            } else {
                this.chartWrapper.attr("style", null);
            }
        }

        public enumerateObjectInstances(options: EnumerateVisualObjectInstancesOptions): VisualObjectInstanceEnumeration {
            const instanceEnumeration: VisualObjectInstanceEnumeration = SunburstSettings.enumerateObjectInstances(
                this.settings || SunburstSettings.getDefault(),
                options);
            if (options.objectName === Sunburst.LegendPropertyIdentifier.objectName) {
                this.enumerateColors(instanceEnumeration);
            }
            return instanceEnumeration || [];
        }

        private enumerateColors(instanceEnumeration: VisualObjectInstanceEnumeration): void {
            const topCategories: SunburstSlice[] = this.data.root.children;
            if (topCategories && topCategories.length > 0) {
                topCategories.forEach((category: SunburstSlice) => {
                    const displayName: string = category.name.toString();
                    const identity: ISelectionId = category.selector as ISelectionId;
                    this.addAnInstanceToEnumeration(instanceEnumeration, {
                        displayName,
                        objectName: Sunburst.LegendPropertyIdentifier.objectName,
                        selector: ColorHelper.normalizeSelector(identity.getSelector(), false),
                        properties: {
                            fill: { solid: { color: category.color } }
                        }
                    });
                });
            }
        }

        private addAnInstanceToEnumeration(
            instanceEnumeration: VisualObjectInstanceEnumeration,
            instance: VisualObjectInstance): void {

            if ((instanceEnumeration as VisualObjectInstanceEnumerationObject).instances) {
                (instanceEnumeration as VisualObjectInstanceEnumerationObject)
                    .instances
                    .push(instance);
            } else {
                (instanceEnumeration as VisualObjectInstance[]).push(instance);
            }
        }

        private updateInternal(): void {
            const self: Sunburst = this;
            const partition: d3.layout.Partition<d3.layout.partition.Node> = d3.layout.partition()
                .size([2 * Math.PI, Sunburst.OuterRadius * Sunburst.OuterRadius])
                .value((d: d3.layout.partition.Node) => {
                    return d.value;
                })
                .sort(null);
            const pathSelection: d3.selection.Update<TooltipEnabledDataPoint> = this.main.datum<SunburstSlice>(this.data.root)
                .selectAll("path")
                .data<SunburstSlice>(<any>partition.nodes);
            pathSelection
                .enter()
                .append("path")
                .classed(this.appCssConstants.slice.className, true)
                .style("display", (slice: SunburstSlice) => slice.depth ? null : "none")
                .attr("d", this.arc)
                .style("fill", (d: SunburstSlice) => d.color)
                .on("click", this.onSliceClick.bind(this));
            if (this.settings.group.showDataLabels) {

                pathSelection.each(function (d: SunburstSlice, i: number) {
                    if (!d.depth) {
                        return;
                    }
                    const firstArcSection: RegExp = /(^.+?)L/;
                    let newArc: string = firstArcSection.exec(d3.select(this).attr("d"))[1];
                    newArc = newArc.replace(/,/g, " ");
                    self.main.append("path")
                        .classed(self.appCssConstants.sliceHidden.className, true)
                        .attr("id", "sliceLabel_" + i)
                        .attr("d", newArc);
                });
                self.main.selectAll(this.appCssConstants.sliceLabel.selectorName)
                    .data<SunburstSlice>(<any>partition.nodes)
                    .enter()
                    .append("text")
                    .classed(this.appCssConstants.sliceLabel.className, true)
                    // font size + slice padding
                    .attr("dy", 18)
                    .append("textPath")
                    .attr("startOffset", "50%")
                    .attr("xlink:href", (d, i) => "#sliceLabel_" + i)
                    .text((d: SunburstSlice) => <string>d.name)
                    .each(this.wrapPathText(Sunburst.DefaultDataLabelPadding))
                    .on("click", this.onSliceClick.bind(this));
            }
            this.renderTooltip(pathSelection);

            pathSelection
                .exit()
                .remove();
        }

        private onSliceClick(slice: SunburstSlice): void {
            if (slice.selector) {
                this.selectionManager.select(slice.selector);
            }
            this.highlightPath(slice, this, true);
            const percentage: string = this.getFormattedValue(slice.total / this.data.total, this.percentageFormatter);
            this.percentageLabel.data([percentage]);
            this.percentageLabel.style("fill", slice.color);
            this.selectedCategoryLabel.data([slice ? slice.tooltipInfo[0].displayName : ""]);
            this.selectedCategoryLabel.style("fill", slice.color);
            this.calculateLabelPosition();
            this.labelsHidden = false;
            (<MouseEvent>(d3.event)).stopPropagation();
        }

        private convert(dataView: DataView, colors: IColorPalette, visualHost: IVisualHost): SunburstData {
            const data: SunburstData = {
                total: 0,
                root: null
            };
            const valueFormatString: string = valueFormatter.getFormatStringByColumn(dataView.matrix.columns.levels[0].sources[0], true);
            const formatter: IValueFormatter = valueFormatter.create(
                {
                    cultureSelector: this.visualHost.locale,
                    format: valueFormatString,
                    allowFormatBeautification: true
                });
            data.root = this.covertTreeNodeToSunBurstNode(
                dataView.matrix.rows.root, null,
                colors, [], data,
                undefined, visualHost, 1, formatter);

            return data;
        }

        private covertTreeNodeToSunBurstNode(
            originParentNode: DataViewTreeNode,
            sunburstParentNode: SunburstSlice,
            colors: IColorPalette,
            pathIdentity: DataViewScopeIdentity[],
            data: SunburstData,
            color: string,
            visualHost: IVisualHost,
            level: number,
            formatter: IValueFormatter): SunburstSlice {

            if (originParentNode.identity) {
                pathIdentity = pathIdentity.concat([originParentNode.identity]);
            }

            const selectionIdBuilder: visuals.ISelectionIdBuilder = visualHost.createSelectionIdBuilder();
            const colorHelper: ColorHelper = new ColorHelper(
                colors,
                Sunburst.LegendPropertyIdentifier);
            pathIdentity.forEach((identity: DataViewScopeIdentity) => {
                const categoryColumn: DataViewCategoryColumn = {
                    source: {
                        displayName: null,
                        queryName: identity.key
                    },
                    values: null,
                    identity: [identity]
                };

                selectionIdBuilder.withCategory(categoryColumn, 0);
            });

            const selectionId: ISelectionId = selectionIdBuilder.createSelectionId();
            const valueToSet: number = originParentNode.values
                ? <number>originParentNode.values[0].value
                : 0;
            const newSunNode: SunburstSlice = {
                name: originParentNode.value,
                value: Math.max(valueToSet, 0),
                selector: selectionId,
                key: selectionId
                    ? selectionId.getKey()
                    : null,
                total: valueToSet,
                children: []
            };
            if (originParentNode.value) {
                newSunNode.color = color
                    ? color
                    : color = colorHelper.getColorForMeasure(originParentNode.objects, originParentNode.name);
            }

            data.total += newSunNode.value;
            newSunNode.children = [];

            if (originParentNode.children && originParentNode.children.length > 0) {

                for (const child of originParentNode.children) {
                    const newChild: SunburstSlice = this.covertTreeNodeToSunBurstNode(
                        child,
                        newSunNode,
                        colors,
                        pathIdentity,
                        data,
                        newSunNode.color,
                        visualHost,
                        level + 1,
                        formatter);

                    newSunNode.children.push(newChild);
                    newSunNode.total += newChild.total;
                }
            }
            newSunNode.tooltipInfo = this.getTooltipData(<string>originParentNode.value, newSunNode.total, formatter);

            if (sunburstParentNode) {
                newSunNode.parent = sunburstParentNode;
            }

            return newSunNode;
        }

        private getTooltipData(displayName: string, value: number, formatter: IValueFormatter): VisualTooltipDataItem[] {
            return [{
                displayName,
                value: this.getFormattedValue(value, formatter)
            }];
        }

        public getFormattedValue(value: number, formatter: IValueFormatter): string {
            return value < 0
                ? ""
                : formatter.format(value);
        }

        private parseSettings(dataView: DataView): SunburstSettings {
            return SunburstSettings.parse<SunburstSettings>(dataView);
        }

        // Get all parents of the node
        private static getTreePath(node: SunburstSlice): SunburstSlice[] {
            const path: SunburstSlice[] = [];
            let current: SunburstSlice = node;

            while (current.parent) {
                path.unshift(current);
                current = current.parent;
            }

            return path;
        }

        private static createLegend(data: SunburstData, settings: SunburstSettings): LegendData {
            const rootCategory: SunburstSlice[] = data.root.children;
            const legendData: LegendData = {
                fontSize: settings.legend.fontSize,
                dataPoints: [],
                title: settings.legend.showTitle ? (settings.legend.titleText) : null,
                labelColor: settings.legend.labelColor
            };
            legendData.dataPoints = rootCategory.map((element: SunburstSlice) => {
                return {
                    label: element.name as string,
                    color: element.color,
                    icon: LegendIcon.Circle,
                    selected: false,
                    identity: element.selector
                };
            });
            return legendData;
        }

        private calculateLabelPosition(): void {
            const innerRadius: number = Math.min.apply(
                null,
                this.data.root.children.map((x: SunburstSlice) => this.arc.innerRadius()(x, undefined))
            );
            this.setPercentageLabelPosition(innerRadius);
            this.setCategoryLabelPosition(innerRadius);
        }

        private setCategoryLabelPosition(width: number): void {
            const self = this;
            if (this.selectedCategoryLabel) {
                const labelSize: number = this.settings.group.fontSize;
                this.selectedCategoryLabel
                    .attr(CssConstants.transformProperty, translate(0, labelSize * -Sunburst.CategoryLineInterval))
                    .style("font-size", PixelConverter.toString(labelSize))
                    .text((x: string) => x).each(function (d: string) { self.wrapText(d3.select(this), Sunburst.DefaultDataLabelPadding, width); });
            }
        }

        private setPercentageLabelPosition(width: number): void {
            const self = this;
            const labelSize: number = this.settings.group.fontSize * Sunburst.PercentageFontSizeMultiplier;
            const labelTransform: number = labelSize *
                (this.settings.group.showSelected ?
                    Sunburst.MultilinePercentageLineInterval :
                    Sunburst.DefaultPercentageLineInterval);
            this.percentageLabel
                .attr(CssConstants.transformProperty, translate(0, labelTransform))
                .style("font-size", PixelConverter.toString(labelSize))
                .text((x: string) => x).each(function (d: string) { self.wrapText(d3.select(this), Sunburst.DefaultDataLabelPadding, width); });
        }

        private highlightPath(d: SunburstSlice, sunBurst: Sunburst, setUnhide: boolean): void {
            const parentsArray: SunburstSlice[] = d ? Sunburst.getTreePath(d) : [];
            // Set opacity for all the segments.
            sunBurst.svg
                .selectAll(sunBurst.appCssConstants.sliceSelected.selectorName)
                .classed(sunBurst.appCssConstants.sliceSelected.className, false);
            sunBurst.svg.classed(sunBurst.appCssConstants.mainInteractive.className, true);
            // Highlight only ancestors of the current segment.
            sunBurst.svg.selectAll(sunBurst.appCssConstants.slice.selectorName)
                .filter((path: SunburstSlice) => {
                    return parentsArray.indexOf(path) >= 0;
                })
                .classed(sunBurst.appCssConstants.sliceSelected.className, true);
        }

        private renderTooltip(selection: d3.selection.Update<TooltipEnabledDataPoint>): void {
            if (!this.tooltipService) {
                return;
            }

            this.tooltipService.addTooltip(selection, (tooltipEvent: TooltipEventArgs<SunburstSlice>) => {
                return tooltipEvent.data.tooltipInfo;
            });
        }

        private renderLegend(): void {
            if (!this.data) {
                return;
            }
            const position: LegendPosition = this.settings.legend.show
                ? LegendPosition[this.settings.legend.position]
                : LegendPosition.None;

            this.legend.changeOrientation(position);
            this.legend.drawLegend(this.legendData, JSON.parse(JSON.stringify(this.viewport)));
            Legend.positionChartArea(this.chartWrapper, this.legend);

            switch (this.legend.getOrientation()) {
                case LegendPosition.Left:
                case LegendPosition.LeftCenter:
                case LegendPosition.Right:
                case LegendPosition.RightCenter:
                    this.viewport.width -= this.legend.getMargins().width;
                    break;
                case LegendPosition.Top:
                case LegendPosition.TopCenter:
                case LegendPosition.Bottom:
                case LegendPosition.BottomCenter:
                    this.viewport.height -= this.legend.getMargins().height;
                    break;
            }
        }

        private wrapPathText(padding?: number): (slice: SunburstSlice, index: number) => void {
            const self = this;
            return function (slice: SunburstSlice, index: number) {
                if (!slice.depth) {
                    return;
                }
                const selection: d3.Selection<any> = d3.select(this);
                const width = (<SVGPathElement>d3.select(selection.attr("xlink:href")).node()).getTotalLength();
                self.wrapText(selection, padding, width);
            };
        }

        private wrapText(selection: d3.Selection<any>, padding?: number, width?: number): void {
            let node: SVGTextElement = <SVGTextElement>selection.node(),
                textLength: number = node.getComputedTextLength(),
                text: string = selection.text();
            width = width || (<SVGPathElement>selection.node()).getTotalLength();
            padding = padding || 0;
            while (textLength > (width - 2 * padding) && text.length > 0) {
                text = text.slice(0, -1);
                selection.text(text + "\u2026");
                textLength = node.getComputedTextLength();
            }
            if (textLength > (width - 2 * padding)) {
                selection.text("");
            }
        }

        private clear(): void {
            this.main.selectAll("*")
                .remove();
        }
    }
}
