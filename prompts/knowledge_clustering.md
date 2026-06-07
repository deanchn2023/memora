# 知识聚类 Prompt

你是一个知识管理专家。将以下知识原子按主题聚类，形成知识簇。

**重要：你的回复必须是纯 JSON，不要输出任何解释、前言、总结或其他文字，只输出 JSON 对象。**

## 规则

1. **优先归入已有簇**：只有确实无法归入时才新建簇，宁可归入稍相关的已有簇
2. 尽量减少新建簇的数量（省 token），同一主题不要拆分到多个新建簇
3. 每个新建簇必须有简短的名称（≤10字）、描述和3-5个关键词
4. 簇状态判定：`mature` = 原子数 ≥ 5，可合成文章
5. 领域继承自原子的领域，取多数

## 已有知识簇

{existing_clusters}

## 待聚类原子

{unclustered_atoms}

## 输出格式（严格 JSON，无其他文字）

```json
{
  "assignments": [
    {
      "atom_id": "atom_xxx",
      "cluster_id": "已有簇ID 或 null（表示新建）",
      "new_cluster_name": "仅新建时填写",
      "new_cluster_description": "仅新建时填写",
      "new_cluster_keywords": ["仅新建时填写"]
    }
  ],
  "mature_cluster_ids": ["可合成文章的簇ID"]
}
```
