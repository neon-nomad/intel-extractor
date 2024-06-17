const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const fs = require("fs");
const os = require('os');
const path = require('path');
const parse = require("csv-parse");
const stringify = require("csv-stringify");

puppeteer.use(StealthPlugin());

async function runRosterPuppeteerScript(username, password) {
  const url = "https://robertsspaceindustries.com/";
  const org = "THECODE";
  const orgUrl = `https://robertsspaceindustries.com/orgs/${org}/admin/members`;
  const browser = await puppeteer.launch({
    headless: false,
    executablePath:
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  });
  const page = await browser.newPage();
  await page.goto(url);

  function delay(time) {
    return new Promise((resolve) => setTimeout(resolve, time));
  }

  console.log("Waiting for discover modal...");
  await delay(3000);

  console.log("Closing modal...");
  await page.locator("#overlay_close").click();

  await delay(2000);
  console.log("Opening account menu...");

  await page
    .locator(
      "#platform-bar > section > div > nav > ul.c-platform-list.c-platform-list--rsi.c-platform-navigation-list > li:nth-child(3) > a"
    )
    .click();

  await delay(1000);

  console.log("Enter credentials...");
  await page.locator("#email").click();
  await page.type("#email", username);
  await page.locator("#password").click();
  await page.type("#password", password);
  console.log("Signing in...");
  await page
    .locator(
      "#enlist-root > div > div > div.c-formLegacyEnlist__wrapper > form > div > button"
    )
    .click();

  console.log("Waiting 20 seconds for manual 2FA input...");
  await delay(20000);

  console.log("Navigating to members page...");
  await page.goto(`${orgUrl}`);

  await delay(2000);

  const membersContainer = await page.$("#members-data");
  const totalMembersElement = await page.$(".totalrows.js-totalrows");
  const totalMembers = parseInt(
    await totalMembersElement.evaluate((el) => el.textContent.trim()),
    10
  );
  const elementSelector = ".c-platform-copyright.c-platform-copyright--rsi";
  const cardData = [];

  async function scrollElementIntoView(page, elementSelector) {
    try {
      const element = await page.$(elementSelector);

      if (element) {
        const rect = await element.boundingBox();
        if (rect.top >= 0 && rect.bottom <= page.viewport().height) {
          return;
        }

        await element.scrollIntoView({ block: "start", behavior: "smooth" });
      } else {
        console.warn(`Element with selector "${elementSelector}" not found.`);
      }
    } catch (error) {
      console.error("Error scrolling element into view:", error.message);
    }
  }

  async function scrapeNewCards() {
    const newCards = await membersContainer.$$(".member-item");
    console.log("Card Data Length: ", cardData.length);
    console.log("Scraped Members: ", scrapedMembers.size);
    for (const cardElement of newCards) {
      try {
        const href = await cardElement.$eval("a", (el) => el.href);
        if (!scrapedMembers.has(href) && href) {
          // Check if already scraped
          scrapedMembers.add(href); // Add href to set for future checks

          const nameAndNickname = await cardElement.$eval(
            ".name-wrap",
            (el) => ({
              name: el.querySelector(".name").textContent,
              nickname: el.querySelector(".nick").textContent,
            })
          );

          const card = {
            href,
            name: nameAndNickname.name,
            nickname: nameAndNickname.nickname,
          };

          cardData.push(card);
        }
      } catch (error) {
        console.error(`Error scraping card: ${error.message}`);
      }
    }
  }

  async function writeDataToCSV(data, filename) {
    const headers = [
      "href",
      "name",
      "nickname",
      "mainOrg",
      "altOrg",
      "region",
      "fluency",
    ];
    const csvRows = data.map((row) => {
      return headers.map((fieldName) => `"${row[fieldName] || ""}"`).join(",");
    });
    const csvContent = [headers.join(",")].concat(csvRows).join("\n");
    fs.writeFileSync(filename, csvContent, "utf-8");
  }

  const scrapedMembers = new Set();

  let pageLoads = totalMembers / 32;
  console.log("scraping member page...");
  for (let i = 0; i < pageLoads; i++) {
    await scrollElementIntoView(page, elementSelector);
    await delay(1000);
    const loader =
      (await page.$('.traj-loader.trans-02s[style="opacity: 0;"]')) !== null;
    if (loader) {
      console.log("Loader is present but inactive, likely all cards loaded");
    }
    await scrapeNewCards();
  }

  console.log("Scraped card data:", cardData);
  console.log("Total members:", totalMembers);
  console.log("Scraped card data length:", cardData.length);

  async function scrapeCitizenInfo(href, cardData) {
    try {
      await page.goto(href);

      let mainOrg = "";
      let region = "";
      let fluency = "";

      try {
        mainOrg = await page.$eval(".info > p > a", (el) =>
          el.textContent.trim()
        );
      } catch (error) {
        console.log("Main organization not found for", href);
      }

      const altOrg = `${href}/organizations`;

      const entries = await page.$$eval(".left-col .inner .entry", (entries) =>
        entries.map((entry) => ({
          label: entry.querySelector(".label")
            ? entry.querySelector(".label").textContent.trim()
            : "",
          value: entry.querySelector(".value")
            ? entry
                .querySelector(".value")
                .textContent.trim()
                .replace(/\s+/g, " ")
            : "",
        }))
      );

      entries.forEach((entry) => {
        if (entry.label.includes("Location")) {
          region = entry.value;
        } else if (entry.label.includes("Fluency")) {
          fluency = entry.value;
        }
      });

      cardData.mainOrg = mainOrg;
      cardData.altOrg = altOrg;
      cardData.region = region;
      cardData.fluency = fluency;
    } catch (error) {
      console.error(`Error scraping data for ${href}:`, error);
    }
  }

  console.log("scraping citizen pages...");
  for (const citizen of cardData) {
    await scrapeCitizenInfo(citizen.href, citizen);
  }

  console.log("Updated cardData:", cardData);

  const { parse } = require("csv-parse/sync");

  function readExistingCSV(filePath) {
    const csvData = fs.readFileSync(filePath, "utf8");
    const records = parse(csvData, {
      columns: true,
      skip_empty_lines: true,
    });
    return records;
  }

  const { stringify } = require("csv-stringify/sync");

  function writeNewCSV(data, filePath) {
    const csv = stringify(data, {
      header: true,
    });
    fs.writeFileSync(filePath, csv);
  }

  function updateStatusAndReformat(existingCSVData, scrapedArray) {
    const scrapedLookup = new Map(
      scrapedArray.map((item) => [item.name, item])
    );

    const existingLookup = new Map(
      existingCSVData.map((item) => [item.Name, item])
    );

    scrapedArray.forEach((scrapedItem) => {
      if (existingLookup.has(scrapedItem.name)) {
        const existingItem = existingLookup.get(scrapedItem.name);
        existingItem["Main Org."] =
          scrapedItem.mainOrg || existingItem["Main Org."];
        existingItem.Status = "ACTIVE";
      } else {
        // Append new member with incremented number and role of Agent
        const newItem = {
          "#": existingCSVData.length + 1,
          Role: "Agent",
          Name: scrapedItem.name,
          Handle: scrapedItem.nickname,
          Code: "",
          "Main Org.": scrapedItem.mainOrg,
          "Alt Org.": scrapedItem.altOrg,
          Status: "ACTIVE",
          Spectrum: "MSG",
          Region: scrapedItem.region,
          Fluency: scrapedItem.fluency,
        };
        existingCSVData.push(newItem);
      }
    });

    // Mark members as INACTIVE if they exist only in the existing CSV data
    existingCSVData.forEach((item) => {
      if (!scrapedLookup.has(item.Name)) {
        item.Status = "INACTIVE";
      }
    });

    return existingCSVData;
  }

  const scrapedArray = cardData;
  const existingCSVFilePath = "src/assets/existing_roster.csv";
  const newCSVFilePath = "../../roster/updated_roster.csv";

  const existingCSVData = readExistingCSV(existingCSVFilePath);
  const updatedData = updateStatusAndReformat(existingCSVData, scrapedArray);
  console.log("Scrapped data reformatted to match existing csv...");

  const rosterDirPath = path.join(__dirname, "..", "..", "roster");

  if (!fs.existsSync(rosterDirPath)) {
    fs.mkdir(rosterDirPath, { recursive: true });
  } else {
    console.log("Roster directory already exists.");
  }

  writeNewCSV(updatedData, newCSVFilePath);
  console.log("Updated data written to ", newCSVFilePath);

  await browser.close();
}
async function runCuriousPuppeteerScript(targetOrg) {
  const orgUrl = `https://robertsspaceindustries.com/orgs/${targetOrg}/members`;
  const browser = await puppeteer.launch({
    headless: false,
    executablePath:
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  });
  const page = await browser.newPage();
  await page.goto(orgUrl);

  function delay(time) {
    return new Promise((resolve) => setTimeout(resolve, time));
  }

  console.log("Navigating to members page...");
  await page.goto(`${orgUrl}`);

  await delay(2000);

  const membersContainer = await page.$("#members-data");
  const totalMembersElement = await page.$(".totalrows.js-totalrows");
  const totalMembers = parseInt(
    await totalMembersElement.evaluate((el) => el.textContent.trim()),
    10
  );
  const elementSelector = ".c-platform-copyright.c-platform-copyright--rsi";
  const cardData = [];

  async function scrollElementIntoView(page, elementSelector) {
    try {
      const element = await page.$(elementSelector);

      if (element) {
        const rect = await element.boundingBox();
        if (rect.top >= 0 && rect.bottom <= page.viewport().height) {
          return;
        }

        await element.scrollIntoView({ block: "start", behavior: "smooth" });
      } else {
        console.warn(`Element with selector "${elementSelector}" not found.`);
      }
    } catch (error) {
      console.error("Error scrolling element into view:", error.message);
    }
  }

  async function scrapeNewCards() {
    const newCards = await membersContainer.$$(".member-item");
    console.log("Card Data Length: ", cardData.length);
    console.log("Scraped Members: ", scrapedMembers.size);
    for (const cardElement of newCards) {
      try {
        const href = await cardElement.$eval("a", (el) => el.href);
        if (!scrapedMembers.has(href) && href) {
          // Check if already scraped
          scrapedMembers.add(href); // Add href to set for future checks

          const nameAndNickname = await cardElement.$eval(
            ".name-wrap",
            (el) => ({
              name: el.querySelector(".name").textContent,
              nickname: el.querySelector(".nick").textContent,
            })
          );

          const card = {
            href,
            name: nameAndNickname.name,
            nickname: nameAndNickname.nickname,
          };

          cardData.push(card);
        }
      } catch (error) {
        console.error(`Error scraping card: ${error.message}`);
      }
    }
  }

  async function writeDataToCSV(data, filename) {
    const headers = [
      "href",
      "name",
      "nickname",
      "mainOrg",
      "altOrg",
      "region",
      "fluency",
    ];
    const csvRows = data.map((row) => {
      return headers.map((fieldName) => `"${row[fieldName] || ""}"`).join(",");
    });
    const csvContent = [headers.join(",")].concat(csvRows).join("\n");
    fs.writeFileSync(filename, csvContent, "utf-8");
  }

  const scrapedMembers = new Set();

  let pageLoads = totalMembers / 32;
  console.log("scraping member page...");
  for (let i = 0; i < pageLoads; i++) {
    await scrollElementIntoView(page, elementSelector);
    await delay(1000);
    const loader =
      (await page.$('.traj-loader.trans-02s[style="opacity: 0;"]')) !== null;
    if (loader) {
      console.log("Loader is present but inactive, likely all cards loaded");
    }
    await scrapeNewCards();
  }

  console.log("Scraped card data:", cardData);
  console.log("Total members:", totalMembers);
  console.log("Scraped card data length:", cardData.length);

  async function scrapeCitizenInfo(href, cardData) {
    try {
      await page.goto(href);

      let mainOrg = "";
      let region = "";
      let fluency = "";

      try {
        mainOrg = await page.$eval(".info > p > a", (el) =>
          el.textContent.trim()
        );
      } catch (error) {
        console.log("Main organization not found for", href);
      }

      const altOrg = `${href}/organizations`;

      const entries = await page.$$eval(".left-col .inner .entry", (entries) =>
        entries.map((entry) => ({
          label: entry.querySelector(".label")
            ? entry.querySelector(".label").textContent.trim()
            : "",
          value: entry.querySelector(".value")
            ? entry
                .querySelector(".value")
                .textContent.trim()
                .replace(/\s+/g, " ")
            : "",
        }))
      );

      entries.forEach((entry) => {
        if (entry.label.includes("Location")) {
          region = entry.value;
        } else if (entry.label.includes("Fluency")) {
          fluency = entry.value;
        }
      });

      cardData.mainOrg = mainOrg;
      cardData.altOrg = altOrg;
      cardData.region = region;
      cardData.fluency = fluency;
    } catch (error) {
      console.error(`Error scraping data for ${href}:`, error);
    }
  }

  console.log("scraping citizen pages...");
  for (const citizen of cardData) {
    await scrapeCitizenInfo(citizen.href, citizen);
  }

  console.log("Updated cardData:", cardData);

  function writeNewCSV(data, filePath) {
    const csv = stringify(data, {
      header: true,
    });
    fs.writeFileSync(filePath, csv);
  }

  function getDownloadsFolderPath() {
    const homeDir = os.homedir();
    const downloadsDir = path.join(homeDir, 'Downloads');
    return downloadsDir;
  }

  await browser.close();
}
module.exports = {
  runRosterPuppeteerScript,
  runCuriousPuppeteerScript
};
