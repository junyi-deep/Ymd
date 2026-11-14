const embedded = import.meta.glob<string>('./stickers/*.webp', { query: '?inline', import: 'default', eager: true })

export type ArtKind = '贴纸' | '插图'

const catalog = [
  ['idea', '灵感', '贴纸', '灯泡 创意 点子 light bulb idea'],
  ['done', '完成', '贴纸', '勾选 成功 通过 check done'],
  ['target', '目标', '贴纸', '靶心 计划 target goal'],
  ['launch', '火箭', '贴纸', '发布 启动 上线 rocket launch'],
  ['warning', '注意', '贴纸', '警告 风险 warning risk'],
  ['award', '奖杯', '贴纸', '冠军 里程碑 trophy award'],
  ['flag', '旗帜', '贴纸', '标记 重点 flag milestone'],
  ['puzzle', '拼图', '贴纸', '协作 解题 puzzle'],
  ['team', '团队', '插图', '协作 人员 合作 people team'],
  ['growth', '增长', '插图', '统计 趋势 数据 chart growth'],
  ['book', '阅读', '插图', '书本 学习 教育 book reading'],
  ['calendar', '日历', '插图', '排期 日期 日程 calendar'],
  ['mountains', '山景', '插图', '户外 休假 旅行 mountains travel'],
  ['computer', '电脑', '插图', '硬件 技术 开发 computer'],
  ['messages', '消息', '插图', '沟通 邮件 聊天 mail message'],
  ['world', '世界', '插图', '地球 全球 地理 globe world'],
] as const

export interface MapArt {
  id: string
  label: string
  kind: ArtKind
  keywords: string
  source: string
}

export const mapArt: MapArt[] = catalog.flatMap(([id, label, kind, keywords]) => {
  const source = embedded['./stickers/' + id + '.webp']
  return source ? [{ id, label, kind, keywords, source }] : []
})

export const artTransferType = 'application/x-ymd-map-art'

export function findArt(id: unknown) {
  return mapArt.find(item => item.id === id)
}
