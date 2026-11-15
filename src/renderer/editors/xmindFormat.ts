export const structures: Record<string, string> = {
  mindMap: 'org.xmind.ui.map', logicalStructure: 'org.xmind.ui.logic.right',
  logicalStructureLeft: 'org.xmind.ui.logic.left', organizationStructure: 'org.xmind.ui.org-chart.down',
  catalogOrganization: 'org.xmind.ui.tree.right', timeline: 'org.xmind.ui.timeline.horizontal',
  verticalTimeline: 'org.xmind.ui.timeline.vertical', fishbone: 'org.xmind.ui.fishbone.rightHeaded',
}
export const styleKeys: Record<string, string> = {
  fillColor: 'svg:fill', color: 'fo:color', fontFamily: 'fo:font-family',
  fontSize: 'fo:font-size', fontWeight: 'fo:font-weight', fontStyle: 'fo:font-style',
  textDecoration: 'fo:text-decoration', textAlign: 'fo:text-align',
  borderColor: 'border-line-color', borderWidth: 'border-line-width',
  lineWidth: 'line-width', lineColor: 'line-color',
}
export const shapes: Record<string, string> = {
  rectangle: 'rect', roundedRectangle: 'roundedRect', ellipse: 'ellipse', circle: 'circle', diamond: 'diamond', parallelogram: 'parallelogram',
}

export const progressMarkers = ['task-start', 'task-oct', 'task-quarter', 'task-3oct', 'task-half',
  'task-5oct', 'task-3quar', 'task-7oct', 'task-done'] as const
