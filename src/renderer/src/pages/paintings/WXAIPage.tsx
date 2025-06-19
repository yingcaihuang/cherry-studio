import { PlusOutlined } from '@ant-design/icons'
import { Navbar, NavbarCenter, NavbarRight } from '@renderer/components/app/Navbar'
import Scrollbar from '@renderer/components/Scrollbar'
import TranslateButton from '@renderer/components/TranslateButton'
import { isMac } from '@renderer/config/constant'
import { usePaintings } from '@renderer/hooks/usePaintings'
import { useAllProviders } from '@renderer/hooks/useProvider'
import { useRuntime } from '@renderer/hooks/useRuntime'
import FileManager from '@renderer/services/FileManager'
import { useAppDispatch } from '@renderer/store'
import { setGenerating } from '@renderer/store/runtime'
import type { WXAIPainting } from '@renderer/types'
import { getErrorMessage, uuid } from '@renderer/utils'
import { Button, Select } from 'antd'
import TextArea from 'antd/es/input/TextArea'
import type { FC } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import SendMessageButton from '../home/Inputbar/SendMessageButton'
import { SettingHelpLink, SettingTitle } from '../settings'
import Artboard from './components/Artboard'
import { DynamicFormRender } from './components/DynamicFormRender'
import PaintingsList from './components/PaintingsList'
import { DEFAULT_WXAI_PAINTING, type WXAIModel } from './config/wxaiConfig'
import WXAIService from './utils/WXAIService'

const Container = styled.div`
  display: flex;
  flex-direction: column;
  height: 100vh;
`

const ContentContainer = styled.div`
  display: flex;
  flex: 1;
  overflow: hidden;
`

const MainContainer = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
`

const SettingsContainer = styled.div`
  padding: 20px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-background);
`

const InputContainer = styled.div`
  position: relative;
  border-top: 1px solid var(--color-border);
  background: var(--color-background);
`

const Textarea = styled(TextArea)`
  border: none !important;
  box-shadow: none !important;
  resize: none;
  padding: 20px;
  font-size: 14px;
  line-height: 1.5;
  background: transparent;

  &:focus {
    border: none !important;
    box-shadow: none !important;
  }
`

const Toolbar = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 20px;
  border-top: 1px solid var(--color-border);
`

const ToolbarMenu = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`

interface Props {
  Options: string[]
}

const WXAIPage: FC<Props> = ({ Options }) => {
  const [models, setModels] = useState<WXAIModel[]>([])
  const [selectedModel, setSelectedModel] = useState<WXAIModel | null>(null)
  const [formData, setFormData] = useState<Record<string, any>>({})

  const { t } = useTranslation()
  const providers = useAllProviders()
  const { addPainting, removePainting, updatePainting, persistentData } = usePaintings()
  const wxaiPaintings = useMemo(
    () => (persistentData as any).wxaiPaintings || [],
    [(persistentData as any).wxaiPaintings]
  )
  const [painting, setPainting] = useState<WXAIPainting>(wxaiPaintings[0] || { ...DEFAULT_WXAI_PAINTING, id: uuid() })

  const providerOptions = Options.map((option) => {
    const provider = providers.find((p) => p.id === option)
    return {
      label: t(`provider.${provider?.id}`),
      value: provider?.id
    }
  })

  const dispatch = useAppDispatch()
  const { generating } = useRuntime()
  const spaceClickTimer = useRef<any>(null)
  const wxaiProvider = providers.find((p) => p.id === 'wxai')!
  const textareaRef = useRef<any>(null)
  const wxaiService = useMemo(() => new WXAIService(wxaiProvider.apiHost, wxaiProvider.apiKey), [wxaiProvider])

  useEffect(() => {
    wxaiService.fetchModels().then((models) => {
      setModels(models)
      if (models.length > 0) {
        setSelectedModel(models[0])
      }
    })
  }, [wxaiService])

  const getNewPainting = useCallback(() => {
    return {
      ...DEFAULT_WXAI_PAINTING,
      id: uuid(),
      model: selectedModel?.id || '',
      inputParams: {},
      generationId: undefined
    }
  }, [selectedModel])

  const updatePaintingState = useCallback(
    (updates: Partial<WXAIPainting>) => {
      setPainting((prevPainting) => {
        const updatedPainting = { ...prevPainting, ...updates }
        updatePainting('wxaiPaintings', updatedPainting)
        return updatedPainting
      })
    },
    [updatePainting]
  )

  const handleError = (error: unknown) => {
    if (error instanceof Error && error.name !== 'AbortError') {
      window.modal.error({
        content: getErrorMessage(error),
        centered: true
      })
    }
  }

  const handleAddPainting = () => {
    const newPainting = getNewPainting()
    addPainting('wxaiPaintings', newPainting)
    setPainting(newPainting)
  }

  const onSelectPainting = (selectedPainting: WXAIPainting) => {
    setPainting(selectedPainting)
  }

  const onDeletePainting = (paintingToDelete: WXAIPainting) => {
    removePainting('wxaiPaintings' as any, paintingToDelete as any)
    if (painting.id === paintingToDelete.id && wxaiPaintings.length > 1) {
      const remainingPaintings = wxaiPaintings.filter((p) => p.id !== paintingToDelete.id)
      setPainting(remainingPaintings[0])
    }
  }

  const isLoading = generating || painting.status === 'processing'

  const onGenerate = async () => {
    if (!selectedModel || !painting.prompt?.trim()) {
      return
    }

    const prompt = painting.prompt.trim()
    const controller = new AbortController()

    dispatch(setGenerating(true))

    try {
      const requestBody = {
        model: selectedModel.id,
        input: {
          prompt,
          ...formData
        }
      }

      const inputParams = { prompt, ...formData }
      updatePaintingState({
        model: selectedModel.id,
        prompt,
        status: 'processing',
        inputParams
      })

      const result = await wxaiService.generateAndWait(requestBody, {
        signal: controller.signal,
        onStatusUpdate: (updates) => {
          updatePaintingState(updates)
        }
      })

      if (result && result.images && result.images.length > 0) {
        const urls = result.images.map((img: { url: string }) => img.url)
        const validFiles = await wxaiService.downloadImages(urls)
        await FileManager.addFiles(validFiles)
        updatePaintingState({ files: validFiles, urls, status: 'succeeded' })
      }
    } catch (error) {
      updatePaintingState({ status: 'failed' })
      handleError(error)
    } finally {
      dispatch(setGenerating(false))
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      onGenerate()
    }
  }

  useEffect(() => {
    if (wxaiPaintings.length === 0) {
      const newPainting = getNewPainting()
      addPainting('wxaiPaintings', newPainting)
      setPainting(newPainting)
    }
  }, [wxaiPaintings, addPainting, getNewPainting])

  useEffect(() => {
    const timer = spaceClickTimer.current
    return () => {
      if (timer) {
        clearTimeout(timer)
      }
    }
  }, [])

  return (
    <Container>
      <Navbar>
        <NavbarCenter style={{ borderRight: 'none' }}>{t('paintings.title')}</NavbarCenter>
        {isMac && (
          <NavbarRight style={{ justifyContent: 'flex-end' }}>
            <Button size="small" className="nodrag" icon={<PlusOutlined />} onClick={handleAddPainting}>
              {t('paintings.button.new.image')}
            </Button>
          </NavbarRight>
        )}
      </Navbar>

      <ContentContainer>
        <MainContainer>
          <SettingsContainer>
            <div style={{ marginBottom: 16 }}>
              <SettingTitle>
                {t('provider.wxai')}
                <SettingHelpLink href="https://cs.rhwx-ai.com/docs" />
              </SettingTitle>
              <Select
                style={{ width: '100%' }}
                placeholder={t('paintings.select_provider')}
                value="wxai"
                options={providerOptions}
                disabled
              />
            </div>

            {selectedModel && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ marginBottom: 8, fontSize: 14, fontWeight: 600 }}>{t('paintings.model')}</div>
                <Select
                  style={{ width: '100%' }}
                  value={selectedModel.id}
                  onChange={(value) => {
                    const model = models.find((m) => m.id === value)
                    if (model) {
                      setSelectedModel(model)
                      updatePaintingState({ model: model.id })
                    }
                  }}
                  options={models.map((model) => ({
                    label: model.name,
                    value: model.id
                  }))}
                />
              </div>
            )}

            {selectedModel && selectedModel.input_schema && selectedModel.input_schema.properties && (
              <div>
                {Object.entries(selectedModel.input_schema.properties).map(([propertyName, schemaProperty]) => (
                  <div key={propertyName} style={{ marginBottom: 16 }}>
                    <div style={{ marginBottom: 8, fontSize: 14, fontWeight: 600 }}>{propertyName}</div>
                    <DynamicFormRender
                      schemaProperty={schemaProperty}
                      propertyName={propertyName}
                      value={formData[propertyName]}
                      onChange={(field: string, value: any) => {
                        setFormData((prev) => ({ ...prev, [field]: value }))
                      }}
                    />
                  </div>
                ))}
              </div>
            )}
          </SettingsContainer>

          <Scrollbar style={{ flex: 1 }}>
            <Artboard
              painting={painting}
              isLoading={isLoading}
              currentImageIndex={0}
              onPrevImage={() => {}}
              onNextImage={() => {}}
              onCancel={() => {}}
            />
          </Scrollbar>

          <InputContainer>
            <Textarea
              ref={textareaRef}
              variant="borderless"
              disabled={isLoading}
              value={painting.prompt || ''}
              spellCheck={false}
              onChange={(e) => updatePaintingState({ prompt: e.target.value })}
              placeholder={t('paintings.prompt_placeholder')}
              onKeyDown={handleKeyDown}
            />
            <Toolbar>
              <ToolbarMenu>
                <TranslateButton
                  text={textareaRef.current?.resizableTextArea?.textArea?.value}
                  onTranslated={(translatedText) => updatePaintingState({ prompt: translatedText })}
                  disabled={isLoading}
                  isLoading={false}
                  style={{ marginRight: 6, borderRadius: '50%' }}
                />
                <SendMessageButton sendMessage={onGenerate} disabled={isLoading} />
              </ToolbarMenu>
            </Toolbar>
          </InputContainer>
        </MainContainer>

        <PaintingsList
          namespace="wxaiPaintings"
          paintings={wxaiPaintings}
          selectedPainting={painting}
          onSelectPainting={onSelectPainting as any}
          onDeletePainting={onDeletePainting as any}
          onNewPainting={handleAddPainting}
        />
      </ContentContainer>
    </Container>
  )
}

export default WXAIPage
