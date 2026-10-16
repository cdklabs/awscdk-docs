# Spike: client-side language tabs (Model B prototype)

> Prototype for the multi-language rendering-model spike.
> This page is intentionally unlisted (no sidebar/nav entry). It proves the
> reusable piece the install/import block and code examples both need: several
> independent `<LanguageTabs>` groups on one page toggling from ONE shared
> language state, persisted in `localStorage` and reflected into `?lang=` for
> shareable URLs.

Pick a language in the **navbar slider** — every variant group below switches
together (the per-block tab strips were retired by issue #68; the groups are
headerless show/hide wrappers now).

## Import / install block

<LanguageTabs :langs="['ts','python']">
<div class="lang-variant" data-lang="ts">

```ts
import * as sqs from 'aws-cdk-lib/aws-sqs';
```

Install: `npm install aws-cdk-lib`

</div>
<div class="lang-variant" data-lang="python">

```python
from aws_cdk import aws_sqs as sqs
```

Install: `pip install aws-cdk-lib`

</div>
</LanguageTabs>

## Initializer signature

<LanguageTabs :langs="['ts','python']">
<div class="lang-variant" data-lang="ts">

<pre v-pre class="signature"><code><span class="sig-keyword">new</span> <span class="sig-name">Queue</span><span class="sig-punct">(</span>
  <span class="sig-param">scope</span><span class="sig-punct">:</span>  <span class="sig-type">Construct</span><span class="sig-punct">,</span>
  <span class="sig-param">id</span><span class="sig-punct">:</span>     <span class="sig-type">string</span><span class="sig-punct">,</span>
  <span class="sig-param">props?</span><span class="sig-punct">:</span> <span class="sig-type">QueueProps</span>
<span class="sig-punct">)</span></code></pre>

</div>
<div class="lang-variant" data-lang="python">

<pre v-pre class="signature"><code><span class="sig-name">sqs.Queue</span><span class="sig-punct">(</span>
  <span class="sig-param">scope</span><span class="sig-punct">,</span>
  <span class="sig-param">id</span><span class="sig-punct">,</span>
  <span class="sig-param">*</span><span class="sig-punct">,</span>
  <span class="sig-param">visibility_timeout</span><span class="sig-punct">=</span><span class="sig-type">None</span><span class="sig-punct">,</span>
  <span class="sig-param">...</span>
<span class="sig-punct">)</span></code></pre>

</div>
</LanguageTabs>

## Code example

<LanguageTabs :langs="['ts','python']">
<div class="lang-variant" data-lang="ts">

```ts
const dlq = new sqs.Queue(this, 'DeadLetterQueue');

const queue = new sqs.Queue(this, 'Queue', {
  deadLetterQueue: { queue: dlq, maxReceiveCount: 3 },
});
```

</div>
<div class="lang-variant" data-lang="python">

```python
dlq = sqs.Queue(self, "DeadLetterQueue")

queue = sqs.Queue(self, "Queue",
    dead_letter_queue=sqs.DeadLetterQueue(queue=dlq, max_receive_count=3),
)
```

</div>
</LanguageTabs>
