/**
 * 优化后的油价查询脚本
 * 建议参数格式：province/city (例如: sichuan/chengdu, shanxi-3/xian, beijing)
 */

let region = 'shanxi-3/xian'; // 默认区域

// 优先获取外部传入参数或持久化存储
if (typeof $argument !== 'undefined' && $argument) {
    region = $argument;
} else {
    const storedRegion = readRegionFromStore();
    if (storedRegion) region = storedRegion;
}

const queryAddr = `http://m.qiyoujiage.com/${region}.shtml`;

$httpClient.get({
    url: queryAddr,
    headers: {
        'Referer': 'http://m.qiyoujiage.com/',
        // 使用更通用的移动端 UA
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1'
    },
}, (error, response, data) => {
    if (error) {
        console.log(`[油价查询] 网络请求失败: ${error}`);
        return $done({});
    }

    try {
        // 1. 检查是否是 404 或错误页面
        if (data.includes('404 Not Found') || !data) {
            console.log(`[油价查询] 页面不存在或为空: ${queryAddr}`);
            return $done({ title: "油价查询失败", content: "地区代码可能错误，请检查 URL 格式" });
        }

        const prices = parsePrices(data);
        const adjustment = parseAdjustment(data);

        // 如果没有抓取到价格，可能是因为页面结构不是详情页（比如只是省份列表页）
        if (prices.length === 0) {
            console.log(`[油价查询] 未匹配到油价数据，请检查地区是否精确到城市: ${queryAddr}`);
            return $done({ 
                title: "油价数据解析失败", 
                content: "未能获取数据，请尝试将地区精确到城市（如 sichuan/chengdu）" 
            });
        }

        // 格式化输出
        const priceContent = prices.map(p => `${p.name}：${p.value} 元/升`).join('\n');
        const tipsContent = adjustment.valid ? `\n\n📅 ${adjustment.date}\n${adjustment.trend} ${adjustment.value}` : "";

        $done({
            title: "今日油价信息",
            content: priceContent + tipsContent,
            icon: "fuelpump.fill",
            "icon-color": "#CA3A05"
        });

    } catch (e) {
        console.error(`[油价查询] 脚本执行异常: ${e.message}`);
        $done({});
    }
});

function readRegionFromStore() {
    try {
        // 兼容不同平台的持久化读取
        if (typeof $persistentStore !== 'undefined') {
            return $persistentStore.read("yj");
        }
    } catch (e) {
        return null;
    }
    return null;
}

function parsePrices(html) {
    // 优化正则：
    // 1. \s* 允许标签之间有空格
    // 2. 不再强制匹配 "(元)"，适应性更强
    // 3. 针对性匹配 89, 92, 95, 98, 0号柴油
    const regPrice = /<dt>\s*(.*?油)\s*<\/dt>[\s\S]+?<dd>\s*([\d\.]+)/g;
    let match;
    const prices = [];

    while ((match = regPrice.exec(html)) !== null) {
        // 过滤掉杂项，只保留常见的油品
        const name = match[1].trim();
        const value = match[2].trim();
        if (name.includes('92') || name.includes('95') || name.includes('98') || name.includes('0号')) {
             prices.push({ name: name, value: value });
        }
    }

    // 排序或截取，通常只需显示前几个
    return prices; 
}

function parseAdjustment(html) {
    // 提取调价信息
    const regDate = /<div class="tishi">\s*<span>(.*?)<\/span>/;
    const regInfo = /<div class="tishi">[\s\S]+?<br\/>([\s\S]+?)<br\/>/;
    
    const dateMatch = html.match(regDate);
    const infoMatch = html.match(regInfo);

    if (dateMatch && infoMatch) {
        let fullDateStr = dateMatch[1].replace(/&nbsp;/g, '').trim();
        // 简单清洗日期字符串，去掉多余的括号
        fullDateStr = fullDateStr.replace(/国内油价|预计|开启/g, ''); 
        
        let infoStr = infoMatch[1].trim();
        
        // 判断涨跌
        let trend = "平稳";
        if (infoStr.includes("下调") || infoStr.includes("下跌")) trend = "📉 下跌";
        else if (infoStr.includes("上调") || infoStr.includes("上涨")) trend = "📈 上涨";

        // 提取变动金额数字
        const moneyMatch = infoStr.match(/([\d\.\-]+)元/);
        const value = moneyMatch ? `${moneyMatch[1]}元` : infoStr;

        return { valid: true, date: fullDateStr, trend, value };
    }

    return { valid: false };
}
