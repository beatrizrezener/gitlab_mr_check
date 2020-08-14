#!/usr/bin/env node

const https = require("https");
const fetch = require('node-fetch');
const chalk = require('chalk');
const yargs = require("yargs");

const ONE_WEEK = 604800000;
const EXPIRATION_INTERVAL = ONE_WEEK * 4;

const agent = new https.Agent({
  rejectUnauthorized: false
});

const options = yargs
 .usage("Usage: -url <gitlab_url> ")
 .option("url", { alias: "gitlab_url", describe: "A URL do GitLab", type: "string", demandOption: true })
 .option("t", { alias: "auth_token", describe: "Seu token de autenticação do GitLab", type: "string", demandOption: true })
 .argv;

const headers = {
  "Authorization": `Bearer ${options.auth_token}`,
  "Content-type": "application/json",
};

const openMRsURL = `${options.url}/api/v4/merge_requests?state=opened`;

(async () => {
  fetch(openMRsURL, { agent, headers })
    .then(response => response.json())
    .then(async data => {
      const not_wip = data.filter(mr => mr.work_in_progress == false);
      console.log(data.length - not_wip.length, "MRs em Progresso (WIP)");
      console.log(not_wip.length, "MRs Abertos:");
      console.log();
      const needAttentionList = [];
      const regularMR = [];

      const resultMap = data.map(async mr => {
        const expirated = checkExpiration(mr.updated_at);
        const notesNotResolved = await mrNotesNotResolved(mr.project_id, mr.iid);
        const mrObject = {
          web_url: mr.web_url,
          title: mr.title,
          notesNotResolved,
          has_conflicts: mr.has_conflicts,
          expirated,
        };
        if (expirated || mr.has_conflicts || notesNotResolved > 0) {
          needAttentionList.push(mrObject) 
        } else {
          regularMR.push(mrObject) 
        }
      });
      Promise.all(resultMap).then(result => {
        if (needAttentionList.length > 0) {
          console.log(chalk.bold(needAttentionList.length, "MRs necessitam de atenção:\n"));
          needAttentionList.sort((a,b) => a.web_url.localeCompare(b.web_url));
          needAttentionList.map(mr => displayMR(mr));
        }

        if (regularMR.length > 0) {
          console.log(chalk.bold(regularMR.length, "MRs em situação regular:\n"));
          regularMR.sort((a,b) => a.web_url.localeCompare(b.web_url));
          regularMR.map(mr => displayMR(mr));
        }
      });
    });
})();

async function mrNotesNotResolved(projectId, mrId) {
  const getNotesURL = `${options.url}/api/v4/projects/${projectId}/merge_requests/${mrId}/notes`;
  const response = await fetch(getNotesURL, { agent, headers });
  const data = await response.json();
  const not_resolved = data.filter(note => note.resolvable && !note.resolved);
  return not_resolved.length;
}

function displayMR({ web_url, title, notesNotResolved, has_conflicts, expirated }) {
  console.log(web_url);
  console.log(title);
  has_conflicts && console.log(chalk.red('Conflito detectado'));
  notesNotResolved > 0 && console.log(chalk.yellow('Comentários não resolvidos:', notesNotResolved));
  expirated && console.log(chalk.yellow('Sem atualização há mais de mês'));

  console.log();
}

function checkExpiration(date) {
  const today = new Date();
  const diff = Math.abs(today - new Date(date));
  return diff > EXPIRATION_INTERVAL;
}