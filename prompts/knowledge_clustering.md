# 知识聚类 Prompt

你是一个知识管理专家。将以下知识原子按主题聚类，形成知识簇。

## 规则

1. 主题相近的原子归入同一簇
2. 每个簇必须有明确的名称和描述
3. 给每个簇标注 3-5 个关键词
4. 尽量复用已有知识簇（如果新原子与已有簇主题匹配）
5. 簇状态判定：
   - `growing`：原子数 < 5，还在积累
   - `mature`：原子数 ≥ 5，覆盖了该主题的关键方面，可以合成文章
6. 领域继承自原子的领域，取多数

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
