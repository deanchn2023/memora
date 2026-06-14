import WidgetKit
import SwiftUI

// MARK: - 数据模型

struct TaskItem: Codable, Identifiable {
    let id: String
    let title: String
    let priority: String // high | medium | low
    let dueDate: String?
    let isCompleted: Bool
    
    var priorityColor: Color {
        switch priority {
        case "high": return .red
        case "medium": return .orange
        default: return .blue
        }
    }
}

struct PomodoroState: Codable {
    let isRunning: Bool
    let remainingSeconds: Int
    let currentTask: String?
    
    var timeDisplay: String {
        let minutes = remainingSeconds / 60
        let seconds = remainingSeconds % 60
        return String(format: "%d:%02d", minutes, seconds)
    }
    
    var progress: Double {
        guard isRunning else { return 0 }
        return Double(25 * 60 - remainingSeconds) / Double(25 * 60)
    }
}

struct WidgetData: Codable {
    let tasks: [TaskItem]
    let pomodoro: PomodoroState?
    let lastUpdated: String
    
    static let placeholder = WidgetData(
        tasks: [
            TaskItem(id: "1", title: "完成项目方案", priority: "high", dueDate: "今天", isCompleted: false),
            TaskItem(id: "2", title: "团队周会", priority: "medium", dueDate: "14:00", isCompleted: false),
            TaskItem(id: "3", title: "整理会议纪要", priority: "low", dueDate: "明天", isCompleted: false)
        ],
        pomodoro: PomodoroState(isRunning: true, remainingSeconds: 18 * 60 + 30, currentTask: "完成项目方案"),
        lastUpdated: ISO8601DateFormatter().string(from: Date())
    )
}

// MARK: - Timeline Provider

struct MemoraWidgetProvider: TimelineProvider {
    func placeholder(in context: Context) -> MemoraWidgetEntry {
        MemoraWidgetEntry(date: Date(), data: .placeholder)
    }
    
    func getSnapshot(in context: Context, completion: @escaping (MemoraWidgetEntry) -> Void) {
        let entry = MemoraWidgetEntry(date: Date(), data: loadWidgetData() ?? .placeholder)
        completion(entry)
    }
    
    func getTimeline(in context: Context, completion: @escaping (Timeline<MemoraWidgetEntry>) -> Void) {
        let data = loadWidgetData() ?? .placeholder
        let entry = MemoraWidgetEntry(date: Date(), data: data)
        
        // 每 15 分钟刷新一次
        let nextUpdate = Calendar.current.date(byAdding: .minute, value: 15, to: Date())!
        let timeline = Timeline(entries: [entry], policy: .after(nextUpdate))
        completion(timeline)
    }
    
    private func loadWidgetData() -> WidgetData? {
        let appGroupID = "group.com.memora.app"
        guard let defaults = UserDefaults(suiteName: appGroupID) else { return nil }
        guard let data = defaults.data(forKey: "widgetData") else { return nil }
        return try? JSONDecoder().decode(WidgetData.self, from: data)
    }
}

struct MemoraWidgetEntry: TimelineEntry {
    let date: Date
    let data: WidgetData
}

// MARK: - Widget Views

struct MemoraWidgetEntryView: View {
    let entry: MemoraWidgetEntry
    @Environment(\.widgetFamily) var family
    
    var body: some View {
        switch family {
        case .systemSmall:
            SmallWidgetView(data: entry.data)
        case .systemMedium:
            MediumWidgetView(data: entry.data)
        default:
            MediumWidgetView(data: entry.data)
        }
    }
}

// 小组件：番茄钟 + Top 1 任务
struct SmallWidgetView: View {
    let data: WidgetData
    
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("M")
                    .font(.system(size: 14, weight: .bold, design: .rounded))
                    .foregroundColor(.white)
                    .frame(width: 22, height: 22)
                    .background(Color.blue)
                    .cornerRadius(6)
                Text("Memora")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(.primary)
                Spacer()
            }
            
            if let pomo = data.pomodoro, pomo.isRunning {
                VStack(alignment: .leading, spacing: 4) {
                    Text(pomo.timeDisplay)
                        .font(.system(size: 28, weight: .bold, design: .rounded))
                        .monospacedDigit()
                        .foregroundColor(.primary)
                    
                    if let task = pomo.currentTask {
                        Text(task)
                            .font(.system(size: 10))
                            .foregroundColor(.secondary)
                            .lineLimit(1)
                    }
                    
                    ProgressView(value: pomo.progress)
                        .tint(.blue)
                        .scaleEffect(y: 0.6)
                }
            } else if let first = data.tasks.first {
                VStack(alignment: .leading, spacing: 4) {
                    Circle()
                        .fill(first.priorityColor)
                        .frame(width: 8, height: 8)
                    Text(first.title)
                        .font(.system(size: 13, weight: .medium))
                        .foregroundColor(.primary)
                        .lineLimit(2)
                    if let due = first.dueDate {
                        Text(due)
                            .font(.system(size: 10))
                            .foregroundColor(.secondary)
                    }
                }
            } else {
                Text("暂无待办 ✨")
                    .font(.system(size: 13))
                    .foregroundColor(.secondary)
            }
        }
        .padding(12)
    }
}

// 中组件：Top 3 任务 + 番茄钟
struct MediumWidgetView: View {
    let data: WidgetData
    
    var body: some View {
        HStack(spacing: 0) {
            // 左：任务列表
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Text("M")
                        .font(.system(size: 11, weight: .bold, design: .rounded))
                        .foregroundColor(.white)
                        .frame(width: 18, height: 18)
                        .background(Color.blue)
                        .cornerRadius(5)
                    Text("今日待办")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundColor(.secondary)
                    Spacer()
                    Text("\(data.tasks.count)")
                        .font(.system(size: 11, weight: .bold, design: .rounded))
                        .foregroundColor(.white)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(Color.blue.opacity(0.15))
                        .cornerRadius(8)
                }
                
                ForEach(data.tasks.prefix(3)) { task in
                    HStack(spacing: 6) {
                        Circle()
                            .fill(task.priorityColor)
                            .frame(width: 6, height: 6)
                        Text(task.title)
                            .font(.system(size: 12, weight: .medium))
                            .foregroundColor(.primary)
                            .lineLimit(1)
                        Spacer()
                        if let due = task.dueDate {
                            Text(due)
                                .font(.system(size: 9))
                                .foregroundColor(.secondary)
                        }
                    }
                }
                
                if data.tasks.isEmpty {
                    Text("所有任务已完成 🎉")
                        .font(.system(size: 12))
                        .foregroundColor(.secondary)
                        .frame(maxWidth: .infinity, alignment: .center)
                        .padding(.top, 8)
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            
            // 分割线
            Rectangle()
                .fill(Color.secondary.opacity(0.1))
                .frame(width: 0.5)
            
            // 右：番茄钟
            VStack(spacing: 6) {
                if let pomo = data.pomodoro, pomo.isRunning {
                    ZStack {
                        Circle()
                            .stroke(Color.secondary.opacity(0.15), lineWidth: 4)
                        Circle()
                            .trim(from: 0, to: pomo.progress)
                            .stroke(Color.blue, style: StrokeStyle(lineWidth: 4, lineCap: .round))
                            .rotationEffect(.degrees(-90))
                        Text(pomo.timeDisplay)
                            .font(.system(size: 16, weight: .bold, design: .rounded))
                            .monospacedDigit()
                    }
                    .frame(width: 56, height: 56)
                    
                    if let task = pomo.currentTask {
                        Text(task)
                            .font(.system(size: 9))
                            .foregroundColor(.secondary)
                            .lineLimit(2)
                            .multilineTextAlignment(.center)
                    }
                } else {
                    Image(systemName: "timer")
                        .font(.system(size: 24))
                        .foregroundColor(.secondary.opacity(0.4))
                    Text("未运行")
                        .font(.system(size: 10))
                        .foregroundColor(.secondary)
                }
            }
            .frame(width: 100)
            .padding(.vertical, 12)
        }
    }
}

// MARK: - Widget Definition

@main
struct MemoraWidgetBundle: WidgetBundle {
    var body: some Widget {
        MemoraWidget()
    }
}

struct MemoraWidget: Widget {
    let kind: String = "MemoraWidget"
    
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: MemoraWidgetProvider()) { entry in
            MemoraWidgetEntryView(entry: entry)
                .containerBackground(for: .widget) {
                    Color.white
                }
        }
        .configurationDisplayName("Memora 待办")
        .description("查看今日 Top 待办和番茄钟状态")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

// MARK: - Preview

#Preview(as: .systemSmall) {
    MemoraWidget()
} timeline: {
    MemoraWidgetEntry(date: Date(), data: .placeholder)
}

#Preview(as: .systemMedium) {
    MemoraWidget()
} timeline: {
    MemoraWidgetEntry(date: Date(), data: .placeholder)
}
