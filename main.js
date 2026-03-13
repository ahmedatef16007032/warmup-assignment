const fs = require("fs");


// Convert a "h:mm:ss am/pm" time string into total seconds
function parseTime(timeStr) {
    const parts = timeStr.trim().split(" ");
    const [h, m, s] = parts[0].split(":").map(Number);
    const period = parts[1].toLowerCase();
    let hours = h;
    if (period === "pm" && hours !== 12) hours += 12;
    if (period === "am" && hours === 12) hours = 0;
    return hours * 3600 + m * 60 + s;
}

// Convert a "h:mm:ss" or "hhh:mm:ss" duration string into total seconds
function parseDuration(str) {
    const [h, m, s] = str.trim().split(":").map(Number);
    return h * 3600 + m * 60 + s;
}

// Format a total-seconds value back into a h:mm:ss string
function formatDuration(totalSec) {
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// Read the driver rates text file and return an array of rate objects
function readRates(rateFile) {
    return fs.readFileSync(rateFile, { encoding: "utf8" })
        .replace(/\r/g, "")
        .split("\n")
        .filter(l => l.trim() !== "")
        .map(l => {
            const c = l.split(",");
            return {
                driverID: c[0],
                dayOff: c[1],
                basePay: parseInt(c[2]),
                tier: parseInt(c[3])
            };
        });
}

// Day names ordered by JavaScript getDay() return values
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// Return the day-of-week name for a "yyyy-mm-dd" date string
function getDayName(dateStr) {
    const [y, mo, d] = dateStr.split("-").map(Number);
    return DAY_NAMES[new Date(y, mo - 1, d).getDay()];
}

// Return true when the date falls inside the Eid holiday window (Apr 10 to 30, 2025)
function isEidPeriod(dateStr) {
    const [y, mo, d] = dateStr.split("-").map(Number);
    return y === 2025 && mo === 4 && d >= 10 && d <= 30;
}

// Return the daily quota in seconds (6 h during Eid, 8 h 24 m on normal days)
function getDailyQuota(dateStr) {
    return isEidPeriod(dateStr) ? 6 * 3600 : 8 * 3600 + 24 * 60;
}


// ============================================================
// Function 1: getShiftDuration(startTime, endTime)
// startTime: (typeof string) formatted as hh:mm:ss am or hh:mm:ss pm
// endTime: (typeof string) formatted as hh:mm:ss am or hh:mm:ss pm
// Returns: string formatted as h:mm:ss
// ============================================================
function getShiftDuration(startTime, endTime) {
    const diffSec = parseTime(endTime) - parseTime(startTime);
    return formatDuration(diffSec);
}

// ============================================================
// Function 2: getIdleTime(startTime, endTime)
// startTime: (typeof string) formatted as hh:mm:ss am or hh:mm:ss pm
// endTime: (typeof string) formatted as hh:mm:ss am or hh:mm:ss pm
// Returns: string formatted as h:mm:ss
// ============================================================
function getIdleTime(startTime, endTime) {
    const start = parseTime(startTime);
    const end = parseTime(endTime);

    // Delivery window is 8:00 AM (28800 s) to 10:00 PM (79200 s)
    const deliveryStart = 8 * 3600;
    const deliveryEnd = 22 * 3600;

    let idle = 0;

    // Time logged before delivery hours begin
    if (start < deliveryStart) idle += Math.min(end, deliveryStart) - start;

    // Time logged after delivery hours end
    if (end > deliveryEnd) idle += end - Math.max(start, deliveryEnd);

    return formatDuration(idle);
}

// ============================================================
// Function 3: getActiveTime(shiftDuration, idleTime)
// shiftDuration: (typeof string) formatted as h:mm:ss
// idleTime: (typeof string) formatted as h:mm:ss
// Returns: string formatted as h:mm:ss
// ============================================================
function getActiveTime(shiftDuration, idleTime) {
    return formatDuration(parseDuration(shiftDuration) - parseDuration(idleTime));
}

// ============================================================
// Function 4: metQuota(date, activeTime)
// date: (typeof string) formatted as yyyy-mm-dd
// activeTime: (typeof string) formatted as h:mm:ss
// Returns: boolean
// ============================================================
function metQuota(date, activeTime) {
    return parseDuration(activeTime) >= getDailyQuota(date);
}

// ============================================================
// Function 5: addShiftRecord(textFile, shiftObj)
// textFile: (typeof string) path to shifts text file
// shiftObj: (typeof object) has driverID, driverName, date, startTime, endTime
// Returns: object with 10 properties or empty object {}
// ============================================================
function addShiftRecord(textFile, shiftObj) {
    const content = fs.readFileSync(textFile, { encoding: "utf8" }).replace(/\r/g, "");
    let lines = content.split("\n");

    // Remove any trailing blank lines before processing
    while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();

    const { driverID, driverName, date, startTime, endTime } = shiftObj;

    // Duplicate check: same driverID and date already in file
    for (let i = 1; i < lines.length; i++) {
        const c = lines[i].split(",");
        if (c[0] === driverID && c[2] === date) return {};
    }

    // Compute all derived fields for the new record
    const shiftDuration = getShiftDuration(startTime, endTime);
    const idleTime = getIdleTime(startTime, endTime);
    const activeTime = getActiveTime(shiftDuration, idleTime);
    const quotaMet = metQuota(date, activeTime);

    const newLine = [driverID, driverName, date, startTime, endTime,
        shiftDuration, idleTime, activeTime, quotaMet, false].join(",");

    // Insert right after the last record of this driver, or append at end
    let lastIdx = -1;
    for (let i = 1; i < lines.length; i++) {
        if (lines[i].split(",")[0] === driverID) lastIdx = i;
    }

    if (lastIdx === -1) lines.push(newLine);
    else lines.splice(lastIdx + 1, 0, newLine);

    fs.writeFileSync(textFile, lines.join("\n") + "\n", { encoding: "utf8" });

    return {
        driverID,
        driverName,
        date,
        startTime,
        endTime,
        shiftDuration,
        idleTime,
        activeTime,
        metQuota: quotaMet,
        hasBonus: false
    };
}

// ============================================================
// Function 6: setBonus(textFile, driverID, date, newValue)
// textFile: (typeof string) path to shifts text file
// driverID: (typeof string)
// date: (typeof string) formatted as yyyy-mm-dd
// newValue: (typeof boolean)
// Returns: nothing (void)
// ============================================================
function setBonus(textFile, driverID, date, newValue) {
    const content = fs.readFileSync(textFile, { encoding: "utf8" }).replace(/\r/g, "");
    const lines = content.split("\n");

    for (let i = 1; i < lines.length; i++) {
        if (lines[i].trim() === "") continue;
        const c = lines[i].split(",");
        if (c[0] === driverID && c[2] === date) {
            c[9] = String(newValue);
            lines[i] = c.join(",");
            break;
        }
    }

    fs.writeFileSync(textFile, lines.join("\n"), { encoding: "utf8" });
}

// ============================================================
// Function 7: countBonusPerMonth(textFile, driverID, month)
// textFile: (typeof string) path to shifts text file
// driverID: (typeof string)
// month: (typeof string) formatted as mm or m
// Returns: number (-1 if driverID not found)
// ============================================================
function countBonusPerMonth(textFile, driverID, month) {
    const lines = fs.readFileSync(textFile, { encoding: "utf8" })
        .replace(/\r/g, "")
        .split("\n")
        .slice(1)
        .filter(l => l.trim() !== "");

    // Return -1 when the driver has no records at all
    const driverLines = lines.filter(l => l.split(",")[0] === driverID);
    if (driverLines.length === 0) return -1;

    // Normalise month to two digits so "4" and "04" both match "04" in the date
    const targetMonth = String(parseInt(month)).padStart(2, "0");

    return driverLines.filter(l => {
        const c = l.split(",");
        return c[2].split("-")[1] === targetMonth && c[9].trim() === "true";
    }).length;
}

// ============================================================
// Function 8: getTotalActiveHoursPerMonth(textFile, driverID, month)
// textFile: (typeof string) path to shifts text file
// driverID: (typeof string)
// month: (typeof number)
// Returns: string formatted as hhh:mm:ss
// ============================================================
function getTotalActiveHoursPerMonth(textFile, driverID, month) {
    const lines = fs.readFileSync(textFile, { encoding: "utf8" })
        .replace(/\r/g, "")
        .split("\n")
        .slice(1)
        .filter(l => l.trim() !== "");

    const targetMonth = String(month).padStart(2, "0");
    let totalSec = 0;

    // Sum activeTime for every matching record, including day-off shifts
    lines.forEach(l => {
        const c = l.split(",");
        if (c[0] === driverID && c[2].split("-")[1] === targetMonth) {
            totalSec += parseDuration(c[7]);
        }
    });

    return formatDuration(totalSec);
}

// ============================================================
// Function 9: getRequiredHoursPerMonth(textFile, rateFile, bonusCount, driverID, month)
// textFile: (typeof string) path to shifts text file
// rateFile: (typeof string) path to driver rates text file
// bonusCount: (typeof number) total bonuses for given driver per month
// driverID: (typeof string)
// month: (typeof number)
// Returns: string formatted as hhh:mm:ss
// ============================================================
function getRequiredHoursPerMonth(textFile, rateFile, bonusCount, driverID, month) {
    const lines = fs.readFileSync(textFile, { encoding: "utf8" })
        .replace(/\r/g, "")
        .split("\n")
        .slice(1)
        .filter(l => l.trim() !== "");

    const driver = readRates(rateFile).find(r => r.driverID === driverID);
    const targetMonth = String(month).padStart(2, "0");
    let totalSec = 0;

    lines.forEach(l => {
        const c = l.split(",");
        if (c[0] !== driverID || c[2].split("-")[1] !== targetMonth) return;

        // Days that fall on the driver's weekly day off are not counted
        if (getDayName(c[2]) === driver.dayOff) return;

        totalSec += getDailyQuota(c[2]);
    });

    // Each bonus earned in the month reduces required hours by 2
    totalSec = Math.max(0, totalSec - bonusCount * 2 * 3600);

    return formatDuration(totalSec);
}

// ============================================================
// Function 10: getNetPay(driverID, actualHours, requiredHours, rateFile)
// driverID: (typeof string)
// actualHours: (typeof string) formatted as hhh:mm:ss
// requiredHours: (typeof string) formatted as hhh:mm:ss
// rateFile: (typeof string) path to driver rates text file
// Returns: integer (net pay)
// ============================================================
function getNetPay(driverID, actualHours, requiredHours, rateFile) {
    const driver = readRates(rateFile).find(r => r.driverID === driverID);
    const actualSec = parseDuration(actualHours);
    const requiredSec = parseDuration(requiredHours);

    // No deduction when the driver meets or exceeds required hours
    if (actualSec >= requiredSec) return driver.basePay;

    // Missing-hour allowances per tier before any deduction kicks in
    const tierAllowance = { 1: 50, 2: 20, 3: 10, 4: 3 };

    const missingHours = (requiredSec - actualSec) / 3600;
    const billableHours = Math.max(0, Math.floor(missingHours - tierAllowance[driver.tier]));

    const deductionRate = Math.floor(driver.basePay / 185);
    return driver.basePay - billableHours * deductionRate;
}

module.exports = {
    getShiftDuration,
    getIdleTime,
    getActiveTime,
    metQuota,
    addShiftRecord,
    setBonus,
    countBonusPerMonth,
    getTotalActiveHoursPerMonth,
    getRequiredHoursPerMonth,
    getNetPay
};
