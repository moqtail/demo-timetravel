/**
 * Copyright 2025 The MOQtail Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import TTPipeline from '../assets/tt-pipeline.svg?react'
import MOQtail from '../assets/moqtail-notext.svg'

function Arch() {
  return (
    <div
      data-wbg
      className="moqtail-bg z-10 container mx-auto flex h-full w-full flex-col items-center justify-center pt-8 max-lg:px-4"
    >
      <h1 className="text-center text-2xl font-bold text-black md:text-4xl">Time Travel in MOQ Conferencing</h1>
      <div className="w-full max-w-5xl overflow-x-auto">
        <TTPipeline className="h-auto w-full min-w-[800px]" />
      </div>
      <div className="pointer-events-none absolute top-0 left-0 h-full w-full overflow-hidden">
        <div className="container mx-auto origin-top-left scale-125">
          <img
            src={MOQtail}
            alt="MOQtail"
            className="h-dvh -translate-x-32 -rotate-[25deg] opacity-5 md:-translate-x-64"
          />
        </div>
      </div>
    </div>
  )
}

export default Arch
