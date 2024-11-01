'use client'

import { useModal } from '@faceless-ui/modal'
import { useRouter, useSearchParams } from 'next/navigation.js'
import {
  type ClientCollectionConfig,
  type ClientGlobalConfig,
  type ClientSideEditViewProps,
  type ClientUser,
} from 'payload'
import React, { Fragment, useCallback, useEffect, useRef, useState } from 'react'

import type { FormProps } from '../../forms/Form/index.js'

import { DocumentControls } from '../../elements/DocumentControls/index.js'
import { useDocumentDrawerContext } from '../../elements/DocumentDrawer/Provider.js'
import { DocumentFields } from '../../elements/DocumentFields/index.js'
import { DocumentLocked } from '../../elements/DocumentLocked/index.js'
import { DocumentTakeOver } from '../../elements/DocumentTakeOver/index.js'
import { Gutter } from '../../elements/Gutter/index.js'
import { IDLabel } from '../../elements/IDLabel/index.js'
import { LeaveWithoutSaving } from '../../elements/LeaveWithoutSaving/index.js'
import { RenderTitle } from '../../elements/RenderTitle/index.js'
import { Upload } from '../../elements/Upload/index.js'
import { Form } from '../../forms/Form/index.js'
import { XIcon } from '../../icons/X/index.js'
import { useAuth } from '../../providers/Auth/index.js'
import { useConfig } from '../../providers/Config/index.js'
import { useDocumentEvents } from '../../providers/DocumentEvents/index.js'
import { useDocumentInfo } from '../../providers/DocumentInfo/index.js'
import { useEditDepth } from '../../providers/EditDepth/index.js'
import { OperationProvider } from '../../providers/Operation/index.js'
import { useServerFunctions } from '../../providers/ServerFunctions/index.js'
import { useTranslation } from '../../providers/Translation/index.js'
import { useUploadEdits } from '../../providers/UploadEdits/index.js'
import { formatAdminURL } from '../../utilities/formatAdminURL.js'
import { handleBackToDashboard } from '../../utilities/handleBackToDashboard.js'
import { handleGoBack } from '../../utilities/handleGoBack.js'
import { handleTakeOver } from '../../utilities/handleTakeOver.js'
import { Auth } from './Auth/index.js'
import './index.scss'
import { SetDocumentStepNav } from './SetDocumentStepNav/index.js'
import { SetDocumentTitle } from './SetDocumentTitle/index.js'

const baseClass = 'collection-edit'

// This component receives props only on _pages_
// When rendered within a drawer, props are empty
// This is solely to support custom edit views which get server-rendered
export const DefaultEditView: React.FC<ClientSideEditViewProps> = ({
  Description,
  PreviewButton,
  PublishButton,
  SaveButton,
  SaveDraftButton,
  Upload: CustomUpload,
}) => {
  const {
    id,
    action,
    AfterDocument,
    AfterFields,
    apiURL,
    BeforeFields,
    collectionSlug,
    currentEditor,
    disableActions,
    disableCreate,
    disableLeaveWithoutSaving,
    docPermissions,
    documentIsLocked,
    getDocPreferences,
    globalSlug,
    hasPublishPermission,
    hasSavePermission,
    initialData: data,
    initialState,
    isEditing,
    isInitializing,
    lastUpdateTime,
    redirectAfterDelete,
    redirectAfterDuplicate,
    setCurrentEditor,
    setDocumentIsLocked,
    setVersionCount,
    unlockDocument,
    updateDocumentEditor,
  } = useDocumentInfo()

  const {
    drawerSlug,
    onCreate: onDrawerCreate,
    onDelete,
    onDuplicate,
    onSave: onSaveFromContext,
  } = useDocumentDrawerContext()

  const isInDrawer = Boolean(drawerSlug)

  const { refreshCookieAsync, user } = useAuth()

  const {
    config,
    config: {
      admin: { user: userSlug },
      routes: { admin: adminRoute },
    },
    getEntityConfig,
  } = useConfig()

  const { t } = useTranslation()
  const { closeModal } = useModal()

  const collectionConfig = getEntityConfig({ collectionSlug }) as ClientCollectionConfig
  const globalConfig = getEntityConfig({ globalSlug }) as ClientGlobalConfig

  const depth = useEditDepth()

  const router = useRouter()
  const params = useSearchParams()
  const { reportUpdate } = useDocumentEvents()
  const { resetUploadEdits } = useUploadEdits()
  const { getFormState } = useServerFunctions()

  const abortControllerRef = useRef(new AbortController())

  const locale = params.get('locale')

  const entitySlug = collectionConfig?.slug || globalConfig?.slug

  const operation = collectionSlug && !id ? 'create' : 'update'

  const auth = collectionConfig ? collectionConfig.auth : undefined
  const upload = collectionConfig ? collectionConfig.upload : undefined

  const docConfig = collectionConfig || globalConfig

  const lockDocumentsProp = docConfig?.lockDocuments !== undefined ? docConfig?.lockDocuments : true
  const isLockingEnabled = lockDocumentsProp !== false

  const lockDurationDefault = 300 // Default 5 minutes in seconds
  const lockDuration =
    typeof lockDocumentsProp === 'object' ? lockDocumentsProp.duration : lockDurationDefault
  const lockDurationInMilliseconds = lockDuration * 1000

  let preventLeaveWithoutSaving = true

  if (collectionConfig) {
    preventLeaveWithoutSaving = !(
      collectionConfig?.versions?.drafts && collectionConfig?.versions?.drafts?.autosave
    )
  } else if (globalConfig) {
    preventLeaveWithoutSaving = !(
      globalConfig?.versions?.drafts && globalConfig?.versions?.drafts?.autosave
    )
  } else if (typeof disableLeaveWithoutSaving !== 'undefined') {
    preventLeaveWithoutSaving = !disableLeaveWithoutSaving
  }

  const [isReadOnlyForIncomingUser, setIsReadOnlyForIncomingUser] = useState(false)
  const [showTakeOverModal, setShowTakeOverModal] = useState(false)

  const [editSessionStartTime, setEditSessionStartTime] = useState(Date.now())

  const lockExpiryTime = lastUpdateTime + lockDurationInMilliseconds

  const isLockExpired = Date.now() > lockExpiryTime

  const documentLockStateRef = useRef<{
    hasShownLockedModal: boolean
    isLocked: boolean
    user: ClientUser
  } | null>({
    hasShownLockedModal: false,
    isLocked: false,
    user: null,
  })

  const classes = [baseClass, (id || globalSlug) && `${baseClass}--is-editing`]

  if (globalSlug) {
    classes.push(`global-edit--${globalSlug}`)
  }

  if (collectionSlug) {
    classes.push(`collection-edit--${collectionSlug}`)
  }

  const [schemaPathSegments, setSchemaPathSegments] = useState(() => {
    if (operation === 'create' && auth && !auth.disableLocalStrategy) {
      return [`_${entitySlug}`, 'auth']
    }

    return [entitySlug]
  })

  const [validateBeforeSubmit, setValidateBeforeSubmit] = useState(() => {
    if (operation === 'create' && auth && !auth.disableLocalStrategy) {
      return true
    }

    return false
  })

  const onSave = useCallback(
    (json) => {
      reportUpdate({
        id,
        entitySlug,
        updatedAt: json?.result?.updatedAt || new Date().toISOString(),
      })

      // If we're editing the doc of the logged-in user,
      // Refresh the cookie to get new permissions
      if (user && collectionSlug === userSlug && id === user.id) {
        void refreshCookieAsync()
      }

      setVersionCount((count) => count + 1)

      if (typeof onSaveFromContext === 'function') {
        void onSaveFromContext({
          ...json,
          operation: id ? 'update' : 'create',
        })
      }

      // Unlock the document after save
      if ((id || globalSlug) && isLockingEnabled) {
        setDocumentIsLocked(false)
      }

      if (!isEditing && depth < 2) {
        // Redirect to the same locale if it's been set
        const redirectRoute = formatAdminURL({
          adminRoute,
          path: `/collections/${collectionSlug}/${json?.doc?.id}${locale ? `?locale=${locale}` : ''}`,
        })
        router.push(redirectRoute)
      } else {
        resetUploadEdits()
      }
    },
    [
      reportUpdate,
      id,
      entitySlug,
      user,
      collectionSlug,
      userSlug,
      setVersionCount,
      onSaveFromContext,
      globalSlug,
      isLockingEnabled,
      isEditing,
      depth,
      refreshCookieAsync,
      setDocumentIsLocked,
      adminRoute,
      locale,
      router,
      resetUploadEdits,
    ],
  )

  const onChange: FormProps['onChange'][0] = useCallback(
    async ({ formState: prevFormState }) => {
      if (abortControllerRef.current) {
        try {
          abortControllerRef.current.abort()
        } catch (e) {
          // swallow error
        }
      }

      const abortController = new AbortController()
      abortControllerRef.current = abortController

      const currentTime = Date.now()
      const timeSinceLastUpdate = currentTime - editSessionStartTime

      const updateLastEdited = isLockingEnabled && timeSinceLastUpdate >= 10000 // 10 seconds

      if (updateLastEdited) {
        setEditSessionStartTime(currentTime)
      }

      const docPreferences = await getDocPreferences()

      const { lockedState, state } = await getFormState({
        id,
        collectionSlug,
        docPermissions,
        docPreferences,
        formState: prevFormState,
        globalSlug,
        operation,
        // Performance optimization: Setting it to false ensure that only fields that have explicit requireRender set in the form state will be rendered (e.g. new array rows).
        // We only wanna render ALL fields on initial render, not in onChange.
        renderAllFields: false,
        returnLockStatus: isLockingEnabled ? true : false,
        schemaPath: schemaPathSegments.join('.'),
        // signal: abortController.signal,
        updateLastEdited,
      })

      setDocumentIsLocked(true)

      if (isLockingEnabled) {
        const previousOwnerId = documentLockStateRef.current?.user?.id

        if (lockedState) {
          const lockedUserID =
            typeof lockedState.user === 'string' || typeof lockedState.user === 'number'
              ? lockedState.user
              : lockedState.user.id

          if (!documentLockStateRef.current || lockedUserID !== previousOwnerId) {
            if (previousOwnerId === user.id && lockedUserID !== user.id) {
              setShowTakeOverModal(true)
              documentLockStateRef.current.hasShownLockedModal = true
            }

            documentLockStateRef.current = documentLockStateRef.current = {
              hasShownLockedModal: documentLockStateRef.current?.hasShownLockedModal || false,
              isLocked: true,
              user: lockedState.user as ClientUser,
            }
            setCurrentEditor(lockedState.user as ClientUser)
          }
        }
      }

      return state
    },
    [
      editSessionStartTime,
      isLockingEnabled,
      getDocPreferences,
      getFormState,
      id,
      collectionSlug,
      globalSlug,
      operation,
      schemaPathSegments,
      setDocumentIsLocked,
      user.id,
      setCurrentEditor,
    ],
  )

  // Clean up when the component unmounts or when the document is unlocked
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        try {
          abortControllerRef.current.abort()
        } catch (e) {
          // swallow error
        }
      }

      if (!isLockingEnabled) {
        return
      }

      const currentPath = window.location.pathname

      const documentId = id || globalSlug

      // Routes where we do NOT want to unlock the document
      const stayWithinDocumentPaths = ['preview', 'api', 'versions']

      const isStayingWithinDocument = stayWithinDocumentPaths.some((path) =>
        currentPath.includes(path),
      )

      // Unlock the document only if we're actually navigating away from the document
      if (documentId && documentIsLocked && !isStayingWithinDocument) {
        // Check if this user is still the current editor
        if (documentLockStateRef.current?.user?.id === user?.id) {
          void unlockDocument(id, collectionSlug ?? globalSlug)
          setDocumentIsLocked(false)
          setCurrentEditor(null)
        }
      }

      setShowTakeOverModal(false)
    }
  }, [
    collectionSlug,
    globalSlug,
    id,
    unlockDocument,
    user,
    setCurrentEditor,
    isLockingEnabled,
    documentIsLocked,
    setDocumentIsLocked,
  ])

  const shouldShowDocumentLockedModal =
    documentIsLocked &&
    currentEditor &&
    currentEditor.id !== user?.id &&
    !isReadOnlyForIncomingUser &&
    !showTakeOverModal &&
    !documentLockStateRef.current?.hasShownLockedModal &&
    !isLockExpired

  return (
    <main className={classes.filter(Boolean).join(' ')}>
      <OperationProvider operation={operation}>
        <Form
          action={action}
          className={`${baseClass}__form`}
          disabled={isReadOnlyForIncomingUser || isInitializing || !hasSavePermission}
          disableValidationOnSubmit={!validateBeforeSubmit}
          initialState={!isInitializing && initialState}
          isInitializing={isInitializing}
          method={id ? 'PATCH' : 'POST'}
          onChange={[onChange]}
          onSuccess={onSave}
        >
          {isInDrawer && (
            <Gutter className={`doc-drawer-header`}>
              <div className={`doc-drawer-header__content`}>
                <h2 className={`doc-drawer-header__text`}>{<RenderTitle element="span" />}</h2>
                {/* TODO: the `button` HTML element breaks CSS transitions on the drawer for some reason...
              i.e. changing to a `div` element will fix the animation issue but will break accessibility
            */}
                <button
                  aria-label={t('general:close')}
                  className={`doc-drawer-header__close`}
                  onClick={() => closeModal(drawerSlug)}
                  type="button"
                >
                  <XIcon />
                </button>
              </div>
              <DocumentTitle />
            </Gutter>
          )}
          {isLockingEnabled && shouldShowDocumentLockedModal && !isReadOnlyForIncomingUser && (
            <DocumentLocked
              handleGoBack={() => handleGoBack({ adminRoute, collectionSlug, router })}
              isActive={shouldShowDocumentLockedModal}
              onReadOnly={() => {
                setIsReadOnlyForIncomingUser(true)
                setShowTakeOverModal(false)
              }}
              onTakeOver={() =>
                handleTakeOver(
                  id,
                  collectionSlug,
                  globalSlug,
                  user,
                  false,
                  updateDocumentEditor,
                  setCurrentEditor,
                  documentLockStateRef,
                  isLockingEnabled,
                )
              }
              updatedAt={lastUpdateTime}
              user={currentEditor}
            />
          )}
          {isLockingEnabled && showTakeOverModal && (
            <DocumentTakeOver
              handleBackToDashboard={() => handleBackToDashboard({ adminRoute, router })}
              isActive={showTakeOverModal}
              onReadOnly={() => {
                setIsReadOnlyForIncomingUser(true)
                setShowTakeOverModal(false)
              }}
            />
          )}
          {!isReadOnlyForIncomingUser && preventLeaveWithoutSaving && <LeaveWithoutSaving />}
          <SetDocumentStepNav
            collectionSlug={collectionConfig?.slug}
            globalSlug={globalConfig?.slug}
            id={id}
            pluralLabel={collectionConfig?.labels?.plural}
            useAsTitle={collectionConfig?.admin?.useAsTitle}
          />
          <SetDocumentTitle
            collectionConfig={collectionConfig}
            config={config}
            fallback={depth <= 1 ? id?.toString() : undefined}
            globalConfig={globalConfig}
          />
          <DocumentControls
            apiURL={apiURL}
            customComponents={{
              PreviewButton,
              PublishButton,
              SaveButton,
              SaveDraftButton,
            }}
            data={data}
            disableActions={disableActions}
            disableCreate={disableCreate}
            hasPublishPermission={hasPublishPermission}
            hasSavePermission={hasSavePermission}
            id={id}
            isEditing={isEditing}
            onDelete={onDelete}
            onDrawerCreate={onDrawerCreate}
            onDuplicate={onDuplicate}
            onSave={onSave}
            onTakeOver={() =>
              handleTakeOver(
                id,
                collectionSlug,
                globalSlug,
                user,
                true,
                updateDocumentEditor,
                setCurrentEditor,
                documentLockStateRef,
                isLockingEnabled,
                setIsReadOnlyForIncomingUser,
              )
            }
            permissions={docPermissions}
            readOnlyForIncomingUser={isReadOnlyForIncomingUser}
            redirectAfterDelete={redirectAfterDelete}
            redirectAfterDuplicate={redirectAfterDuplicate}
            slug={collectionConfig?.slug || globalConfig?.slug}
            user={currentEditor}
          />
          <DocumentFields
            AfterFields={AfterFields}
            BeforeFields={
              BeforeFields || (
                <Fragment>
                  {auth && (
                    <Auth
                      className={`${baseClass}__auth`}
                      collectionSlug={collectionConfig.slug}
                      disableLocalStrategy={collectionConfig.auth?.disableLocalStrategy}
                      email={data?.email}
                      loginWithUsername={auth?.loginWithUsername}
                      operation={operation}
                      readOnly={!hasSavePermission}
                      requirePassword={!id}
                      setSchemaPathSegments={setSchemaPathSegments}
                      setValidateBeforeSubmit={setValidateBeforeSubmit}
                      useAPIKey={auth.useAPIKey}
                      username={data?.username}
                      verify={auth.verify}
                    />
                  )}
                  {upload && (
                    <React.Fragment>
                      {CustomUpload || (
                        <Upload
                          collectionSlug={collectionConfig.slug}
                          initialState={initialState}
                          uploadConfig={upload}
                        />
                      )}
                    </React.Fragment>
                  )}
                </Fragment>
              )
            }
            Description={Description}
            docPermissions={docPermissions}
            fields={docConfig.fields}
            readOnly={isReadOnlyForIncomingUser || !hasSavePermission}
            schemaPathSegments={schemaPathSegments}
          />
          {AfterDocument}
        </Form>
      </OperationProvider>
    </main>
  )
}

const DocumentTitle: React.FC = () => {
  const { id, title } = useDocumentInfo()
  return id && id !== title ? <IDLabel id={id.toString()} /> : null
}
